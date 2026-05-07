import os
import mysql.connector
import ftplib
import decimal
import unicodedata

# Configuración de base de datos desde variables de entorno
DB_CONFIG = {
    'host': os.getenv('DB_HOST_SFTP_CREATOR'),
    'user': os.getenv('DB_USER_SFTP_CREATOR'),
    'password': os.getenv('DB_PASSWORD_SFTP_CREATOR'),
    'database': os.getenv('DB_NAME_SFTP_CREATOR')
}

# Salida local del archivo de clientes
OUTPUT_FILE = "/var/sftp/icompras/cliente.txt"
FIELD_DELIMITER = "|"
DECIMAL_PLACES = 2

# Parámetros para conexión FTP
FTP_HOST = "ftp.icompras360.net"
FTP_USER = "icompras360_309997807"
FTP_PASS = "Joskar309997807.**"
FTP_REMOTE_DIR = "/entrada"

def sanitize_text(text):
    # Quitar acentos, ñ, Ñ y caracteres especiales
    if not isinstance(text, str):
        return "N/A"
    normalized = unicodedata.normalize('NFKD', text)
    encoded = normalized.encode('ASCII', 'ignore')
    decoded = encoded.decode('ASCII')
    # Sustituye saltos de línea y retorno de carro
    return decoded.replace('\n', ' ').replace('\r', ' ').strip()

def format_decimal(val):
    # Asegurar dos decimales en formato string
    try:
        d = decimal.Decimal(str(val))
    except Exception:
        d = decimal.Decimal("0.00")
    return f"{d:.{DECIMAL_PLACES}f}"

def generate_clientes_file():
    # Conectar a MySQL
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)
    query = """
      SELECT cod_cli, nombres, cedula, direccion, telefono, diascredito, email, deuda
      FROM v_cliente;
    """
    cursor.execute(query)
    clientes = cursor.fetchall()
    cursor.close()
    conn.close()

    lines = []
    for cliente in clientes:
        fields = [
            sanitize_text(cliente.get('cedula')) or "N/A",             # 0: codcli
            sanitize_text(cliente.get('nombres')) or "N/A",                # 1: nombre
            sanitize_text(cliente.get('cod_cli')) or "N/A",                 # 2: rif
            sanitize_text(cliente.get('direccion')) or "N/A",              # 3: direccion
            sanitize_text(cliente.get('direccion')) or "N/A",              # 4: entrega (usa dirección)
            sanitize_text(cliente.get('telefono')) or "N/A",               # 5: teléfono
            sanitize_text(cliente.get('nombres')) or "N/A",                # 6: contacto (usa nombre)
            "N/A",                                                          # 7: zona (vacío)
            "N/A",                                                       # 8: usuario
            "N/A",                                                       # 9: clave
            format_decimal("10.00"),                                      # 10: ppago (fijo a 10.00)
            format_decimal(cliente.get('diascredito') or "0"),                        # 11: dcredito
            "ACTIVO",                                                    # 12: estado
            "OFICINA",                                                   # 13: canal
            "0.00",                                                      # 14: límite
            "CREDITO",                                                   # 15: tipo
            "LUNES",                                                     # 16: dcorte
            "0.00",                                                      # 17: dcomercial
            "N/A",                                                       # 18: cadena
            "N/A",                                                       # 19: agenda
            "0.00",                                                      # 20: dinternet
            "N/A",                                                 # 21: ruta
            "N/A",                                                       # 22: cb
            "0.00",                                                      # 23: especial
            "0.00",                                                      # 24: mpermiso
            "0.00",                                                      # 25: dotro
            "0.00",                                                    # 26: saldo
            sanitize_text(cliente.get('email')) or "N/A",                # 27: email
            "PRINCIPAL",                                                 # 28: tipocatalogo
            "N/A",                                                 # 29: codisb
            "1",                                                         # 30: usaprecio
            "0",                                                         # 31: nuevo
            "0.00",                                                     # 32: vencido
            format_decimal(cliente.get('deuda')),                        # 33: saldoDs (se asigna deuda)
            "0.00",                                                     # 34: vencidoDs
            "0.00",                                                   # 35: limiteDs
            "0",                                                         # 36: critSepMoneda
            "0.00",                                                      # 37: DctoPreferencial
            "0",                                                         # 38: codisbactivo
            "N/A",                                                       # 39: codac3
            "N/A",                                                       # 40: coderp
            "0"                                                          # 41: orden
        ]
        line = FIELD_DELIMITER.join(fields)
        lines.append(line)

    # Escribir archivo localmente
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines))
    print(f"Archivo {OUTPUT_FILE} generado con {len(lines)} registros.")

def upload_file_ftp():
    try:
        ftp = ftplib.FTP(FTP_HOST)
        ftp.login(FTP_USER, FTP_PASS)
        ftp.cwd(FTP_REMOTE_DIR)
        with open(OUTPUT_FILE, 'rb') as f:
            ftp.storbinary(f"STOR {os.path.basename(OUTPUT_FILE)}", f)
        ftp.quit()
        print(f"Archivo {OUTPUT_FILE} subido a FTP en {FTP_REMOTE_DIR}")
    except Exception as e:
        print(f"Error al subir el archivo vía FTP: {e}")

def main():
    generate_clientes_file()
    upload_file_ftp()

if __name__ == "__main__":
    main()