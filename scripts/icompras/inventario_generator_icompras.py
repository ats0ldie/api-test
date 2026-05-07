import os
import sys
import mysql.connector
import decimal
from datetime import datetime
import ftplib

DB_CONFIG = {
    'host': os.getenv('DB_HOST_SFTP_CREATOR'),
    'user': os.getenv('DB_USER_SFTP_CREATOR'),
    'password': os.getenv('DB_PASSWORD_SFTP_CREATOR'),
    'database': os.getenv('DB_NAME_SFTP_CREATOR')
}

# Salida local del archivo de inventario
OUTPUT_PATH = "/var/sftp/icompras/inventario.txt"
FIELD_DELIMITER = '|'
DECIMAL_PLACES = 2

# Parámetros para conexión FTP
FTP_HOST = "ftp.icompras360.net"
FTP_USER = "icompras360_309997807"
FTP_PASS = "Joskar309997807.**"
FTP_REMOTE_DIR = "/entrada"

def sanitize_text(text):
    # Elimina acentos, ñ, Ñ y caracteres especiales
    import unicodedata
    if not isinstance(text, str):
        return "N/A"
    text = unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('ASCII')
    text = text.replace('\n', ' ').replace('\r', ' ')
    return text

def upload_file_ftp(file_path, remote_dir):
    try:
        ftp = ftplib.FTP(FTP_HOST)
        ftp.login(FTP_USER, FTP_PASS)
        ftp.cwd(remote_dir)
        with open(file_path, 'rb') as f:
            ftp.storbinary(f"STOR {os.path.basename(file_path)}", f)
        ftp.quit()
        print(f"Archivo {os.path.basename(file_path)} subido a FTP en {remote_dir}")
    except Exception as e:
        print(f"Error al subir el archivo vía FTP: {e}")

def main():
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)

    # 1. Obtener artículos y existencias
    cursor.execute("""
        SELECT
            va.codalternativo,      -- barra
            va.codigoarticulo,      -- codprod
            va.ddetallada,          -- desprod
            va.precioventa2,        -- precio2
            vae.existencia,         -- cantidad
            vae.lote,               -- lote
            DATE_FORMAT(vae.fv, '%Y-%m-%d 00:00:00') AS fv -- fecvence
        FROM v_articulo va
        JOIN v_articulo_existencia vae ON va.codigoarticulo = vae.codigoarticulo
        WHERE vae.existencia > 0;
    """)
    articles = cursor.fetchall()

    # 2. Obtener descuentos activos
    cursor.execute("""
        SELECT
            vt.codigoarticulo,
            vt.lote,
            vt.descuento,
            vo.status_oyd,
            vo.tipomov
        FROM v_ofertasydescuentos vo
        JOIN v_temp_articulos_ofertasydescuentos vt ON vo.id = vt.id_oyd
        WHERE vo.status_oyd = 'ACTIVO';
    """)
    discounts = cursor.fetchall()

    # Consultar el factor cambiario de la tabla v_moneda para id '2'
    cursor.execute("SELECT tasageneral FROM v_moneda WHERE id = '2'")
    row_moneda = cursor.fetchone()
    factor_cambiario = row_moneda['tasageneral'] if row_moneda and 'tasageneral' in row_moneda else "0.00"

    cursor.close()
    conn.close()

    # Diccionarios de descuentos
    discounts_by_lote = {}
    discounts_general = {}
    for row in discounts:
        cod_art = row['codigoarticulo']
        lote = row.get('lote')
        descuento = decimal.Decimal(str(row['descuento']))
        tipomov = str(row['tipomov'])
        if tipomov == '2' and lote:
            key = (cod_art, lote)
            if key not in discounts_by_lote or descuento > discounts_by_lote[key]:
                discounts_by_lote[key] = descuento
        elif tipomov == '0':
            if cod_art not in discounts_general or descuento > discounts_general[cod_art]:
                discounts_general[cod_art] = descuento

    # 3. Generar inventario.txt
    lines = []
    for item in articles:
        barra = sanitize_text(item['codalternativo']) or "N/A"
        codprod = sanitize_text(item['codigoarticulo']) or "N/A"
        desprod = sanitize_text(item['ddetallada']) or "N/A"
        precio2 = decimal.Decimal(str(item['precioventa2'] or "0.00"))
        precio2 = precio2
        cantidad = decimal.Decimal(str(item['existencia'] or "0.00"))
        lote = sanitize_text(item.get('lote') or "N/A")
        fecvence = item.get('fv') or "N/A"

        # Descuento: por lote, luego general, si no 0
        current_descuento = discounts_by_lote.get((codprod, lote), discounts_general.get(codprod, decimal.Decimal('0.00')))

        # Formatear decimales
        def fmt(val): return f"{decimal.Decimal(val):.{DECIMAL_PLACES}f}"

        # Construir línea según estructura (rellenar con valores por defecto)
        line = FIELD_DELIMITER.join([
            barra,                      # 0
            codprod,                    # 1
            desprod,                    # 2
            "M",                        # 3 tipo
            "0.00",                       # 4 iva
            "N",                        # 5 regulado
            "N/A",                      # 6 codprov
            fmt(precio2),               # 7 precio2
            fmt(cantidad),              # 8 cantidad
            "1",                        # 9 bulto
            fmt(current_descuento),     # 10 da
            "0.00",                     # 11 da2 (oferta)
            "0",                        # 12 upre
            "0.00",                     # 13 ppre
            fmt(precio2),               # 14 psugerido
            "0.00",                     # 15 pgris
            "0",                        # 16 nuevo
            "N/A",                      # 17 fechaUltComp (ejemplo fijo)
            "PRINCIPAL",                # 18 tipocatalogo
            "0",                        # 19 cuarentena
            "0.00",                     # 20 dctoneto
            lote,                       # 21 lote
            fecvence,                   # 22 fecvence
            "N/A",                      # 23 marcamodelo
            "N/A",                      # 24 pactivo
            "0.00",                     # 25 costo
            "N/A",                      # 26 ubicacion
            "N/A",                      # 27 descorta
            "N/A",                      # 28 codisb (ejemplo fijo)
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),  # 29 feccatalogo
            "N/A",                      # 30 departamento
            "N/A",                      # 31 grupo
            "N/A",                      # 32 subgrupo
            "N/A",                      # 33 opc1
            "N/A",                      # 34 opc2
            "N/A",                      # 35 opc3
            "0.00",                     # 36 precio2
            "0.00",                     # 37 precio3
            "0.00",                     # 38 precio4
            "0.00",                     # 39 precio5
            "0.00",                     # 40 precio6
            "1",                        # 41 undmin
            "99999999",                 # 42 undmax
            "0",                        # 43 undmultiplo
            "0",                        # 44 cantpub
            str(int(cantidad)),         # 45 cantreal
            "0",                        # 46 manejalote
            "0",                        # 47 indevolutivo
            "N/A",                      # 48 codcolor
            "N/A",                      # 49 codtalla
            "0",                        # 50 psicotropico
            "NORMAL",                   # 51 clase
            "BSS",                      # 52 moneda
            fmt(factor_cambiario),      # 53 factorcambiario (valor obtenido de v_moneda)
            "0",                        # 54 refrigerado
            "0",                        # 55 FlagFactOM
            "0.00",                     # 56 dv
            "N/A",                      # 57 dvDetalle
            "0",                        # 58 SuperOFertaMincp
            "0",                        # 59 dcredito
            "0",                        # 60 cantcomp
            "0.00",                     # 61 dct
            "N/A",                      # 62 codac3
        ])
        lines.append(line)

    # Guardar archivo
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f"Archivo inventario.txt generado en {OUTPUT_PATH} con {len(lines)} registros.")

    # Subir archivo vía FTP
    upload_file_ftp(OUTPUT_PATH, FTP_REMOTE_DIR)

if __name__ == "__main__":
    main()