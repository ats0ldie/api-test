#!/usr/bin/env python3

import subprocess
import os
import sys
import mysql.connector
import re
from datetime import datetime
import decimal # Para manejar la precisión de los decimales
import tempfile
import shutil # Para eliminar el directorio temporal
import unicodedata

# Configuración de la Base de Datos (variables de entorno)
DB_CONFIG = {
    'host': os.getenv('DB_HOST_SFTP_CREATOR'),
    'user': os.getenv('DB_USER_SFTP_CREATOR'),
    'password': os.getenv('DB_PASSWORD_SFTP_CREATOR'),
    'database': os.getenv('DB_NAME_SFTP_CREATOR'),
    'port': 3939
}

# Directorio Base SFTP
SFTP_BASE_DIR = "/var/sftp" # Para los archivos de inventario finales
SFTP_CLIENTS_DIR = "/var/sftp/clientes" # Directorio de los chroot de clientes

# Configuración de formato de salida del archivo
FIELD_DELIMITER = ';'
DECIMAL_SEPARATOR = '.'
DECIMAL_PLACES = 2

# Usamos el contexto Decimal para asegurar la precisión
decimal.getcontext().prec = 10 # Suficiente precisión para los cálculos

# Mapeo de segmentos a archivos (segme -> nombre_base)
SEGMENT_MAP = {
    '08': 'convenio',
    '07': 'vinotinto',
    '06': 'azul',
    '05': 'naranja',
    '04': 'amarillo',
    '03': 'verde',
    '02': 'rosado',
    '01': 'blanco'
}

def sanitize_text(text):
    if not isinstance(text, str):
        return "N/A"
    normalized_text = unicodedata.normalize('NFKD', text)
    ascii_text = normalized_text.encode('ASCII', 'ignore').decode('ASCII')
    return ascii_text.replace('\n', ' ').replace('\r', ' ')

def check_sudo():
    """
    Verifica si el script tiene permisos de sudo.
    """
    try:
        # Intenta ejecutar un comando simple con sudo sin pedir contraseña
        # sudo -n true devuelve 0 si tiene permisos sin password, 1 si necesita password o no tiene permisos.
        result = subprocess.run(['sudo', '-n', 'true'], capture_output=True, text=True)
        if result.returncode != 0:
            print("ERROR: Este script requiere permisos de sudo.")
            print("Por favor, asegúrese de que el usuario tenga permisos NOPASSWD para este script en sudoers.")
            print("Ejemplo: su_usuario ALL=(root) NOPASSWD: /usr/bin/python3 /opt/sftp_scripts/inventario_generator.py")
            sys.exit(1)
    except FileNotFoundError:
        print(f"ERROR: Comando 'sudo' no encontrado. Asegúrese de que sudo está instalado y en el PATH.")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR al verificar permisos de sudo: {e}")
        sys.exit(1)

def _execute_command(command_list, input_data=None):
    """
    Ejecuta un comando de sistema con sudo.
    """
    try:
        process = subprocess.Popen(
            ['sudo'] + command_list,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            stdin=subprocess.PIPE if input_data else None
        )
        stdout, stderr = process.communicate(input=input_data)

        if process.returncode != 0:
            print(f"[{os.getpid()}] ERROR al ejecutar comando: {' '.join(command_list)}")
            print(f"[{os.getpid()}] Stdout: {stdout.strip()}")
            print(f"[{os.getpid()}] Stderr: {stderr.strip()}")
            return False
        else:
            return True
    except FileNotFoundError:
        print(f"[{os.getpid()}] ERROR: Comando '{command_list[0]}' no encontrado. Verifica tu PATH y la instalación.")
        return False
    except Exception as e:
        print(f"[{os.getpid()}] Ocurrió un error inesperado al ejecutar comando: {e}")
        return False

def format_decimal(value):
    try:
        return f"{float(value):.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR)
    except (ValueError, TypeError):
        return "0.00"

def format_date(date_str):
    # Entrada YYYY-MM-DD, Salida DD/MM/YYYY
    if not date_str or date_str == 'N/A':
        return ""
    try:
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return dt.strftime('%d/%m/%Y')
    except ValueError:
        return date_str

def generate_and_distribute_inventory():
    print(f"[{os.getpid()}] Iniciando script de generación y distribución de inventario...")
    
    # Verificar permisos de sudo al inicio
    check_sudo()
    
    # Crear directorio temporal para los archivos
    temp_dir = None # Inicializar a None para el finally
    try:
        temp_dir = tempfile.mkdtemp()
        print(f"[{os.getpid()}] Usando directorio temporal: {temp_dir}")
    except Exception as e:
        print(f"[{os.getpid()}] ERROR: No se pudo crear el directorio temporal: {e}")
        sys.exit(1)
        
    generated_inventory_paths = {}

    conn = None
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(dictionary=True)

        # Consultar el factor cambiario de la tabla "monecam"
        cursor.execute("SELECT oficial FROM monecam ORDER BY fecha DESC LIMIT 1")
        row_moneda = cursor.fetchone()
        factor_cambiario = decimal.Decimal(str(row_moneda['oficial'])) if row_moneda and row_moneda.get('oficial') else decimal.Decimal("0.00")

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

        # --- 1. Generar archivos TXT base ---
        print(f"[{os.getpid()}] Generando archivos TXT para cada segmento...")
        
        for segment_code, base_name in SEGMENT_MAP.items():
            cursor.execute(base_query, (segment_code,))
            articles_raw = cursor.fetchall()

            products_grouped = {}
            for item in articles_raw:
                barra = sanitize_text(item['barras'])
                if not barra: continue

                if barra not in products_grouped:
                    products_grouped[barra] = {
                        "barra": barra,
                        "codigo": sanitize_text(item['codigo']),
                        "descripcion": sanitize_text(item['descrip']),
                        "existencia_total": 0,
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

                lote_info = {
                    "lote": sanitize_text(item.get('lote')),
                    "fv": item.get('fv') or "N/A",
                    "existencia": float(decimal.Decimal(str(item['existencia_lote'])).quantize(decimal.Decimal('0.00'))),
                    "precio_base": float(precio_base_usd.quantize(decimal.Decimal(f'1.{"0"*DECIMAL_PLACES}'))),
                    "descuento": float((d_especial * 100).quantize(decimal.Decimal('0.00'))),
                    "precio_con_descuento": float(precio_final_usd.quantize(decimal.Decimal(f'1.{"0"*DECIMAL_PLACES}')))
                }
                products_grouped[barra]["lotes"].append(lote_info)

            inventory_lines = []
            for barra, p in products_grouped.items():
                if p['existencia_total'] <= 0:
                    continue

                p['lotes'].sort(key=lambda x: x.get('fv') or '9999-12-31')
                first_lote = p['lotes'][0] if p['lotes'] else {}

                codigo = str(p.get('codigo', ''))
                barra_field = str(p.get('barra', ''))
                descripcion = str(p.get('descripcion', ''))
                fv = format_date(first_lote.get('fv', ''))
                precio_principal = format_decimal(first_lote.get('precio_base', 0))
                descuento = format_decimal(first_lote.get('descuento', 0))
                precio_con_descuento = format_decimal(first_lote.get('precio_con_descuento', 0))
                existencia_total = str(int(p.get('existencia_total', 0)))

                line = FIELD_DELIMITER.join([
                    codigo, barra_field, descripcion, fv,
                    precio_principal, descuento, precio_con_descuento, existencia_total
                ])
                inventory_lines.append(line)
            
            # Guardar TXT
            txt_filename = f"{base_name}.txt"
            temp_txt_path = os.path.join(temp_dir, txt_filename)
            final_txt_path = os.path.join(SFTP_BASE_DIR, txt_filename)
            
            with open(temp_txt_path, 'w', encoding='utf-8') as f:
                f.write("\n".join(inventory_lines))
                
            if _execute_command(['mv', temp_txt_path, final_txt_path]):
                _execute_command(['chown', 'root:root', final_txt_path])
                _execute_command(['chmod', '644', final_txt_path])
                generated_inventory_paths[base_name] = final_txt_path
                print(f"[{os.getpid()}] Generado {txt_filename}")
            else:
                print(f"[{os.getpid()}] Error al mover {txt_filename}")
        
        # --- 2. Distribuir a Clientes ---
        print(f"[{os.getpid()}] Distribuyendo a clientes en {SFTP_CLIENTS_DIR}...")
        
        if not os.path.exists(SFTP_CLIENTS_DIR):
             print(f"[{os.getpid()}] ERROR: Directorio de clientes no existe.")
             return

        client_dirs = [d for d in os.listdir(SFTP_CLIENTS_DIR) if os.path.isdir(os.path.join(SFTP_CLIENTS_DIR, d))]
        
        for client_dir in client_dirs:
            # El nombre del directorio es C + codigo (ej: C00123)
            if not client_dir.startswith('C'):
                continue
            
            client_code = client_dir[1:] # Quitar la 'C'
            
            # Consultar segmento del cliente
            query = "SELECT segme FROM scli WHERE cliente = %s"
            cursor.execute(query, (client_code,))
            result = cursor.fetchone()
            
            if not result:
                # Cliente no encontrado en DB o no activo
                continue
                
            segme = result['segme']
            target_base_name = SEGMENT_MAP.get(segme)
            
            if not target_base_name:
                print(f"[{os.getpid()}] Segmento '{segme}' no mapeado para cliente {client_dir}.")
                continue
                
            source_path = generated_inventory_paths.get(target_base_name)
            if not source_path:
                print(f"[{os.getpid()}] Archivo fuente para '{target_base_name}' no disponible.")
                continue
                
            dest_path = os.path.join(SFTP_CLIENTS_DIR, client_dir, "inventario.txt")
            
            print(f"[{os.getpid()}] Copiando {target_base_name}.txt a {client_dir}...")
            try:
                if _execute_command(['cp', source_path, dest_path]):
                    _execute_command(['chown', 'root:root', dest_path])
                    _execute_command(['chmod', '644', dest_path])
                else:
                    print(f"[{os.getpid()}] Falló la copia para {client_dir}")

            except Exception as e:
                print(f"[{os.getpid()}] ERROR procesando {client_dir}: {e}")

    except mysql.connector.Error as err:
        print(f"[{os.getpid()}] Error de base de datos: {err}")
        sys.exit(1)
    except Exception as e:
        print(f"[{os.getpid()}] Ocurrió un error inesperado: {e}")
        sys.exit(1)
    finally:
        # Limpiar el directorio temporal de Python (este sí se elimina)
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir) # Borra el directorio y su contenido
                print(f"[{os.getpid()}] Directorio temporal '{temp_dir}' eliminado.")
            except Exception as e:
                print(f"[{os.getpid()}] ADVERTENCIA: No se pudo eliminar el directorio temporal '{temp_dir}': {e}")
        
        if 'conn' in locals() and conn and conn.is_connected():
            if 'cursor' in locals() and cursor:
                try:
                    cursor.close()
                except Exception as e:
                    print(f"[{os.getpid()}] ADVERTENCIA: Error al cerrar el cursor en finally: {e}")
            conn.close()
            print(f"[{os.getpid()}] Conexión a la DB cerrada.")
        print(f"[{os.getpid()}] Script de generación y distribución de inventario finalizado.")

if __name__ == "__main__":
    generate_and_distribute_inventory()