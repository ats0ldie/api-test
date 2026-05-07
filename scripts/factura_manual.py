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

# Configuración de la Base de Datos (variables de entorno)
DB_CONFIG = {
    'host': os.getenv('DB_HOST_SFTP_CREATOR'),
    'user': os.getenv('DB_USER_SFTP_CREATOR'),
    'password': os.getenv('DB_PASSWORD_SFTP_CREATOR'),
    'database': os.getenv('DB_NAME_SFTP_CREATOR'),
    'port': 3939
}

# Directorios SFTP
SFTP_BASE_DIR = "/var/sftp"
SFTP_CLIENTS_DIR = "/var/sftp/clientes"

# Configuración de formato de salida del archivo
FIELD_DELIMITER = ';'
DECIMAL_SEPARATOR = '.'
DECIMAL_PLACES = 2
IVA_PERCENTAGE = decimal.Decimal('16.00') # 16% fijo

# Usamos el contexto Decimal para asegurar la precisión
decimal.getcontext().prec = 10 # Suficiente precisión para los cálculos

def check_sudo():
    """
    Verifica si el script tiene permisos de sudo.
    """
    try:
        result = subprocess.run(['sudo', '-n', 'true'], capture_output=True, text=True)
        if result.returncode != 0:
            print("ERROR: Este script requiere permisos de sudo.")
            print("Por favor, asegúrese de que el usuario tenga permisos NOPASSWD para este script en sudoers.")
            print("Ejemplo: su_usuario ALL=(root) NOPASSWD: /usr/bin/python3 /opt/sftp_scripts/factura_generator.py")
            sys.exit(1)
    except FileNotFoundError:
        print(f"ERROR: Comando 'sudo' no encontrado. Asegúrese de que sudo está instalado y en el PATH.")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR al verificar permisos de sudo: {e}")
        sys.exit(1)

def _sanitize_linux_username(username):
    """
    Sanitiza un nombre de usuario para que sea compatible con los requisitos de Linux,
    y luego lo convierte COMPLETAMENTE a MAYÚSCULAS.
    """
    if not isinstance(username, str):
        return ""

    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', username)
    sanitized = re.sub(r'_+', '_', sanitized)
    sanitized = sanitized.strip('_')
    
    if not sanitized or sanitized[0].isdigit() or sanitized.startswith(('-', '_')):
        sanitized = 'SFTPUSER_' + sanitized

    sanitized = sanitized.upper()

    if len(sanitized) > 32:
        sanitized = sanitized[:32]
        
    return sanitized

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

def generate_and_distribute_invoices(target_username_input, start_date_str, end_date_str, client_code_input):
    """
    Genera y distribuye facturas para un usuario SFTP específico y un rango de fechas dado.
    """
    print(f"[{os.getpid()}] Iniciando script de generación y distribución de facturas...")
    
    # Verificar permisos de sudo al inicio
    check_sudo()

    # Parsear las fechas de entrada
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        if start_date > end_date:
            print(f"[{os.getpid()}] ERROR: La fecha de inicio ({start_date_str}) no puede ser posterior a la fecha de fin ({end_date_str}).")
            sys.exit(1)
    except ValueError:
        print(f"[{os.getpid()}] ERROR: Formato de fecha inválido. Use YYYY-MM-DD.")
        sys.exit(1)

    print(f"[{os.getpid()}] Generando facturas para el usuario SFTP '{target_username_input}' y cliente Código '{client_code_input}' desde {start_date_str} hasta {end_date_str}")

    # Crear directorio temporal para los archivos
    temp_dir = None
    try:
        temp_dir = tempfile.mkdtemp()
        print(f"[{os.getpid()}] Usando directorio temporal: {temp_dir}")
    except Exception as e:
        print(f"[{os.getpid()}] ERROR: No se pudo crear el directorio temporal: {e}")
        sys.exit(1)
        
    conn = None
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(dictionary=True)

        # --- 1. Obtener el Cliente SFTP específico ---
        sanitized_username = _sanitize_linux_username(target_username_input)
        print(f"[{os.getpid()}] Consultando datos del cliente con Código: '{client_code_input}'...")
        query_client = """
        SELECT
            nombre AS usuario,
            sicm,
            rifci AS cedula
        FROM
            scli
        WHERE
            cliente = %s;
        """
        cursor.execute(query_client, (client_code_input,)) # Usamos el código de cliente para la consulta
        sftp_clients = cursor.fetchall()

        if not sftp_clients:
            print(f"[{os.getpid()}] ERROR: No se encontró un cliente en la tabla 'scli' con el Código '{client_code_input}'.")
            sys.exit(1)
        elif len(sftp_clients) > 1:
            print(f"[{os.getpid()}] ADVERTENCIA: Se encontraron múltiples clientes SFTP activos con el nombre de usuario '{target_username_input}'. Se procesará el primero.")
            
        client = sftp_clients[0] # Tomamos el primer cliente encontrado

        client_sftp_invoices_dir = os.path.join(SFTP_CLIENTS_DIR, sanitized_username, "facturas")

        if not os.path.isdir(client_sftp_invoices_dir):
            print(f"[{os.getpid()}] ADVERTENCIA: Directorio de facturas '{client_sftp_invoices_dir}' no existe para usuario '{sanitized_username}'. Saltando.")
            sys.exit(1) # Salimos si el directorio de facturas no existe para el usuario específico

        print(f"[{os.getpid()}] Procesando facturas para el cliente con Código '{client_code_input}' y depositando en la carpeta del usuario SFTP '{sanitized_username}'...")
        
        # Obtener facturas para el cliente dentro del rango de fechas
        query_invoices = """
        SELECT
            numero AS ndocumento,
            nfiscal AS ncontrol,
            fecha,
            totals AS totalbruto,
            descuento,
            descu1 AS descuento1,
            exento,
            iva,
            totalg AS totalneto,
            transac AS codigofactura
        FROM
            sfac
        WHERE
            cod_cli = %s
        AND
            DATE(fecha) BETWEEN %s AND %s;
        """
        cursor.execute(query_invoices, (client_code_input, start_date, end_date))
        invoices = cursor.fetchall()
        print(f"[{os.getpid()}] Encontradas {len(invoices)} facturas para el rango de fechas para '{sanitized_username}'.")

        for invoice in invoices:
            # --- MODIFICACIÓN: Omitir ceros a la izquierda del nombre del archivo ---
            doc_number_str = str(invoice['ndocumento'])
            cleaned_doc_number = doc_number_str.lstrip('0')
            # Si el número era '0' o '00', lstrip lo dejará vacío. En ese caso, usamos '0'.
            if not cleaned_doc_number:
                cleaned_doc_number = '0'
            
            invoice_filename = f"{cleaned_doc_number}.txt"
            temp_invoice_path = os.path.join(temp_dir, invoice_filename)
            final_invoice_path = os.path.join(client_sftp_invoices_dir, invoice_filename)
            
            # Si el archivo ya existe en el destino, saltarlo (no borrar si ya existen)
            if os.path.exists(final_invoice_path):
                print(f"[{os.getpid()}] ADVERTENCIA: Factura '{invoice_filename}' ya existe en el destino. Saltando generación.")
                continue

            invoice_lines = []

            # --- Datos para el Encabezado (E) ---
            # Calcular total_numero_unidades a partir de los ítems
            query_invoice_items = """
            SELECT
                si.codigoa AS codigoarticulo,
                sinv.barras AS codalternativo,
                si.desca AS ddetallada,
                si.cana AS cantidad,
                si.lote,
                si.preca AS costo,
                si.descu AS descuento,
                si.pvp AS pvp,
                si.iva AS iva,
                li.vence AS fechavencimiento
            FROM
                sitems si
            LEFT JOIN
                sinv ON si.codigoa = sinv.codigo
            LEFT JOIN (
                SELECT codigo, lote, MAX(vence) as vence
                FROM lotesinv
                GROUP BY codigo, lote
            ) li ON si.codigoa = li.codigo AND si.lote = li.lote
            WHERE
                si.transac = %s;
            """
            cursor.execute(query_invoice_items, (invoice['codigofactura'],))
            invoice_items = cursor.fetchall()
            
            total_numero_unidades = decimal.Decimal('0.00')
            
            # Para calcular el total_numero_unidades
            for item in invoice_items:
                cantidad_item = decimal.Decimal(str(item['cantidad'])) if item['cantidad'] is not None else decimal.Decimal('0.00')
                total_numero_unidades += cantidad_item


            # Formatear valores para el encabezado
            # Asegurarse de que los valores numéricos de la DB se conviertan a Decimal de forma segura
            ndocumento_val = str(invoice['ndocumento'])
            ncontrol_val = str(invoice['ncontrol']) if invoice['ncontrol'] else '0'
            fecha_val = invoice['fecha'].strftime('%Y-%m-%d') if invoice['fecha'] else ''
            sicm_val = str(client['sicm']) if client['sicm'] else '0'
            totalbruto_val = decimal.Decimal(str(invoice['totalbruto'])) if invoice['totalbruto'] is not None else decimal.Decimal('0.00')
            descuento_val = decimal.Decimal(str(invoice['descuento'])) if invoice['descuento'] is not None else decimal.Decimal('0.00') # Asumido como el monto total
            descuento1_percent_val = decimal.Decimal(str(invoice['descuento1'])) if invoice['descuento1'] is not None else decimal.Decimal('0.00')
            exento_val = decimal.Decimal(str(invoice['exento'])) if invoice['exento'] is not None else decimal.Decimal('0.00')
            
            # Calcular baseimponible como totalbruto menos el descuento
            if descuento1_percent_val > decimal.Decimal('0.00'):
                baseimponible_val = totalbruto_val - (totalbruto_val * (descuento1_percent_val / decimal.Decimal('100.00')))
            else:
                baseimponible_val = totalbruto_val
            
            iva_val = decimal.Decimal(str(invoice['iva'])) if invoice['iva'] is not None else decimal.Decimal('0.00')
            totalneto_val = decimal.Decimal(str(invoice['totalneto'])) if invoice['totalneto'] is not None else decimal.Decimal('0.00')


            header_line = FIELD_DELIMITER.join([
                'E',
                ndocumento_val,
                ncontrol_val,
                fecha_val,
                sicm_val,
                f"{total_numero_unidades:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                f"{totalbruto_val:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                f"{descuento_val:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                f"{descuento1_percent_val:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                f"{exento_val:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                f"{baseimponible_val:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                f"{iva_val:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                f"{IVA_PERCENTAGE:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR), # porcentaje_monto_iva
                f"{totalneto_val:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR)
            ])
            invoice_lines.append(header_line)

            # --- Datos para los Renglones (R) ---
            for item in invoice_items:
                codalternativo = str(item['codalternativo']) if item['codalternativo'] else ''
                ddetallada = str(item['ddetallada']) if item['ddetallada'] else ''
                cantidad = decimal.Decimal(str(item['cantidad'])) if item['cantidad'] is not None else decimal.Decimal('0.00')
                lote = str(item['lote']) if item['lote'] else ''
                
                fechavencimiento = item['fechavencimiento'].strftime('%Y-%m-%d') if item['fechavencimiento'] else ''
                
                costo_item = decimal.Decimal(str(item['costo'])) if item['costo'] is not None else decimal.Decimal('0.00')
                descuento_item_percent = decimal.Decimal(str(item['descuento'])) if item['descuento'] is not None else decimal.Decimal('0.00')

                # precio_unitario_final: se toma directamente de 'pvp' para evitar recalcularlo
                precio_unitario_final_item = decimal.Decimal(str(item['pvp'])) if item['pvp'] is not None else decimal.Decimal('0.00')
                
                # baseimponible_item: precio_unitario_final * cantidad
                baseimponible_item_calculated = precio_unitario_final_item * cantidad
                
                # Porcentaje_IVA del ítem se obtiene de la columna 'iva' (0 o 16)
                if item['iva'] is not None:
                    porcentaje_IVA_item = decimal.Decimal(str(item['iva']))
                else:
                    porcentaje_IVA_item = decimal.Decimal('0.00')

                line = FIELD_DELIMITER.join([
                    'R',
                    codalternativo,
                    ddetallada,
                    f"{cantidad:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                    lote,
                    fechavencimiento,
                    f"{costo_item:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                    f"{descuento_item_percent:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                    f"{precio_unitario_final_item:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR),
                    f"{baseimponible_item_calculated:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR), # total del detalle = base imponible del producto
                    f"{porcentaje_IVA_item:.{DECIMAL_PLACES}f}".replace('.', DECIMAL_SEPARATOR)
                ])
                invoice_lines.append(line)

            # --- Escribir el archivo de factura temporal y moverlo ---
            print(f"[{os.getpid()}] Generando y guardando '{invoice_filename}' en '{temp_invoice_path}'...")
            
            success_writing_temp = False
            success_moving_final = False
            success_chown_chmod = False

            try:
                with open(temp_invoice_path, 'w', encoding='utf-8') as f:
                    f.write("\n".join(invoice_lines))
                success_writing_temp = True

                if _execute_command(['mv', temp_invoice_path, final_invoice_path]):
                    success_moving_final = True
                else:
                    print(f"[{os.getpid()}] ERROR: No se pudo mover el archivo de factura de '{temp_invoice_path}' a '{final_invoice_path}'.")
                    continue 
                
                if _execute_command(['chown', 'root:root', final_invoice_path]) and \
                   _execute_command(['chmod', '644', final_invoice_path]):
                    success_chown_chmod = True
                else:
                    print(f"[{os.getpid()}] ADVERTENCIA: Falló la asignación de propietario/permisos para '{final_invoice_path}'.")
                    continue

                if success_writing_temp and success_moving_final and success_chown_chmod:
                    print(f"[{os.getpid()}] Factura '{final_invoice_path}' generada exitosamente.")
                else:
                    print(f"[{os.getpid()}] ADVERTENCIA: La generación completa de la factura '{invoice_filename}' no fue exitosa.")

            except Exception as e:
                print(f"[{os.getpid()}] ERROR: Ocurrió un error al generar o mover la factura '{invoice_filename}': {e}")
                continue

        cursor.close()

    except mysql.connector.Error as err:
        print(f"[{os.getpid()}] Error de base de datos: {err}")
        sys.exit(1)
    except Exception as e:
        print(f"[{os.getpid()}] Ocurrió un error inesperado: {e}")
        sys.exit(1)
    finally:
        # Limpiar el directorio temporal de Python
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
        print(f"[{os.getpid()}] Script de generación y distribución de facturas finalizado.")

if __name__ == "__main__":
    if len(sys.argv) != 5:
        print("Uso: python3 factura_manual.py <nombre_usuario_sftp> <fecha_inicio_YYYY-MM-DD> <fecha_fin_YYYY-MM-DD> <codigo_cliente>")
        sys.exit(1)
    
    target_username = sys.argv[1]
    start_date_str = sys.argv[2]
    end_date_str = sys.argv[3]
    client_code = sys.argv[4]
    
    generate_and_distribute_invoices(target_username, start_date_str, end_date_str, client_code)