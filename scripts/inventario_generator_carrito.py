import os
import mysql.connector
import decimal
from datetime import datetime
import json
import unicodedata

# Parámetros de conexión a la BD
DB_CONFIG = {
    'host': os.getenv('DB_HOST_SFTP_CREATOR'),
    'user': os.getenv('DB_USER_SFTP_CREATOR'),
    'password': os.getenv('DB_PASSWORD_SFTP_CREATOR'),
    'database': os.getenv('DB_NAME_SFTP_CREATOR'),
    'port': 3939
}

# Ruta base para los archivos JSON de salida
OUTPUT_PATH = "/var/sftp/carrito/"
DECIMAL_PLACES = 2

def sanitize_text(text):
    if not isinstance(text, str):
        return "N/A"
    normalized_text = unicodedata.normalize('NFKD', text)
    ascii_text = normalized_text.encode('ASCII', 'ignore').decode('ASCII')
    return ascii_text.replace('\n', ' ').replace('\r', ' ')

def main():
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)

    try:
        # Consultar el factor cambiario de la tabla "monecam"
        cursor.execute("SELECT oficial FROM monecam ORDER BY fecha DESC LIMIT 1")
        row_moneda = cursor.fetchone()
        factor_cambiario = decimal.Decimal(str(row_moneda['oficial'])) if row_moneda and row_moneda.get('oficial') else decimal.Decimal("0.00")

        # 1. Obtener los segmentos de clientes para generar las listas de precios
        cursor.execute("SELECT segmento, descrip, descvol FROM scliseg")
        segments = cursor.fetchall()

        base_query = """
            SELECT
                a.codigo,
                a.barras,
                CONCAT(a.descrip, " (", COALESCE(e.descrip, ''), ")") AS descrip,
                ROUND(ROUND(a.based1, 3), 2) AS precio_base,
                COALESCE(i.descvol / 100, 0) * (a.conjunto != 'X') AS d_segmento,
                COALESCE(
                    (
                        SELECT 
                            CASE 
                                -- Si existe al menos una condición con lista donde el producto califica, tomar el MAX de esas
                                WHEN MAX(CASE 
                                        WHEN xx_inner.listaprd != '' AND xx_inner.listaprd IS NOT NULL 
                                             AND a.codigo IN (SELECT codigo FROM itlistai WHERE numero = xx_inner.listaprd)
                                        THEN xx_inner.descuento 
                                        ELSE NULL 
                                     END) IS NOT NULL
                                THEN MAX(CASE 
                                        WHEN xx_inner.listaprd != '' AND xx_inner.listaprd IS NOT NULL 
                                             AND a.codigo IN (SELECT codigo FROM itlistai WHERE numero = xx_inner.listaprd)
                                        THEN xx_inner.descuento 
                                        ELSE NULL 
                                     END)
                                -- Si no califica en ninguna lista, tomar la condición genérica (sin lista)
                                ELSE MAX(CASE 
                                        WHEN (xx_inner.listaprd = '' OR xx_inner.listaprd IS NULL)
                                        THEN xx_inner.descuento 
                                        ELSE NULL 
                                     END)
                            END
                        FROM pfacondi xx_inner
                        WHERE FIND_IN_SET(a.prvreg, xx_inner.codigo) > 0 
                          AND xx_inner.tipod = 'E' 
                          AND CURDATE() BETWEEN xx_inner.desde AND xx_inner.hasta
                    ), 0
                ) / 100 AS d_especial,
                IF(CURDATE() BETWEEN a.fdesde AND a.fhasta, COALESCE(a.pescala1 / 100, 0), 0) AS d_oferta,
                COALESCE(f.existen, 0) AS existencia_total_item,
                COALESCE(g.existen, 0) AS existencia_lote,
                g.lote,
                COALESCE(DATE_FORMAT(g.vence, '%Y-%m-%d'), 'N/A') AS fv,
                a.iva
            FROM sinv AS a
            JOIN grup b ON a.grupo = b.grupo
            JOIN itsinv f ON a.codigo = f.codigo AND f.alma = '0001'
            LEFT JOIN lotesinv g ON a.codigo = g.codigo AND g.vence <> '0000-00-00' AND g.existen > 0
            LEFT JOIN scliseg i ON i.segmento = %s
            LEFT JOIN sinvprec h ON a.codigo = h.codigo
            LEFT JOIN dpto c ON b.depto = c.depto
            LEFT JOIN line d ON b.linea = d.linea
            LEFT JOIN sc_pactivo e ON a.cpactivo = e.id
            LEFT JOIN sprv j ON a.prvreg = j.proveed
            WHERE a.activo = 'S'
              AND f.existen > 0
              AND a.codigo NOT LIKE 'BOL%'
            ORDER BY b.nom_grup, a.descrip
        """

        for segment in segments:
            segment_code = segment['segmento']
            segment_name = sanitize_text(segment['descrip']).lower()
            
            # Pasa el código del segmento como parámetro
            cursor.execute(base_query, (segment_code,))
            articles_with_lots = cursor.fetchall()
            
            products_grouped = {}
            for item in articles_with_lots:
                barra = sanitize_text(item['barras'])
                if not barra: continue

                if barra not in products_grouped:
                    products_grouped[barra] = {
                        "barra": barra,
                        "codigo": sanitize_text(item['codigo']),
                        "descripcion": sanitize_text(item['descrip']),
                        "existencia_total": 0,
                        "precio_principal": 0,
                        "precio_principal_tasa": 0,
                        "lotes": [],
                        "_codigos_vistos": set()
                    }

                # Sumar el stock de itsinv solo una vez por código para este código de barras
                if item['codigo'] not in products_grouped[barra]["_codigos_vistos"]:
                    products_grouped[barra]["existencia_total"] += float(item['existencia_total_item'] or 0)
                    products_grouped[barra]["_codigos_vistos"].add(item['codigo'])

                precio_base_usd = decimal.Decimal(str(item['precio_base'] or '0.00'))
                
                d_segmento = decimal.Decimal(str(item['d_segmento']))
                d_especial = decimal.Decimal(str(item['d_especial']))
                d_oferta = decimal.Decimal(str(item['d_oferta']))

                # Calcular precio final con descuentos en USD, aplicando en cadena
                precio_final_usd = precio_base_usd * (1 - d_segmento) * (1 - d_especial) * (1 - d_oferta)
                precio_final_bs = precio_final_usd * factor_cambiario

                lote_info = {
                    "lote": sanitize_text(item.get('lote')),
                    "fv": item.get('fv') or "N/A",
                    "existencia": float(decimal.Decimal(str(item['existencia_lote'])).quantize(decimal.Decimal('0.00'))),
                    "precio_base": float(precio_base_usd.quantize(decimal.Decimal(f'1.{"0"*DECIMAL_PLACES}'))),
                    "precio_base_tasa": float((precio_base_usd * factor_cambiario).quantize(decimal.Decimal(f'1.{"0"*DECIMAL_PLACES}'))),
                    "dcliente": float((d_segmento * 100).quantize(decimal.Decimal('0.00'))),
                    "descuento": float((d_especial * 100).quantize(decimal.Decimal('0.00'))),
                    "precio_con_descuento": float(precio_final_usd.quantize(decimal.Decimal(f'1.{"0"*DECIMAL_PLACES}'))),
                    "precio_con_descuento_tasa": float(precio_final_bs.quantize(decimal.Decimal(f'1.{"0"*DECIMAL_PLACES}')))
                }
                products_grouped[barra]["lotes"].append(lote_info)

            registros = list(products_grouped.values())

            for product in registros:
                # Quitar el set temporal para que no salga en el JSON
                product.pop("_codigos_vistos", None)
                
                product['lotes'].sort(key=lambda x: x.get('fv') or '9999-12-31')
                if product['lotes']:
                    product['precio_principal'] = product['lotes'][0]['precio_base']
                    product['precio_principal_tasa'] = product['lotes'][0]['precio_base_tasa']

            registros_con_existencia = [p for p in registros if p.get('existencia_total', 0) > 0]

            file_path = os.path.join(OUTPUT_PATH, f"{segment_name}.json")
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(registros_con_existencia, f, ensure_ascii=False, indent=4)
            print(f"Archivo {os.path.basename(file_path)} generado con {len(registros_con_existencia)} registros.")

    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    main()
