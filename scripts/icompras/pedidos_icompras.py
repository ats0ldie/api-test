import os
import ftplib
import tempfile
import ssl
import smtplib
import shutil
from datetime import datetime
from email.message import EmailMessage

import openpyxl

# Parámetros FTP
FTP_HOST = "ftp.icompras360.net"
FTP_USER = "icompras360_309997807"
FTP_PASS = "Joskar309997807.**x"
FTP_SALIDA_DIR = "/salida"

# Parámetros SMTP (configurados en variables de entorno o ajusta aquí)
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.tuhost.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "tuusuario@tuhost.com")
SMTP_PASS = os.getenv("SMTP_PASS", "tuclave")
MAIL_TO = "atencion@drogueriajoskar.com"

# Directorio local donde se copia el pedido para evitar duplicados
DEST_DIR = "/var/sftp/icompras/pedidos/"

if not os.path.exists(DEST_DIR):
    os.makedirs(DEST_DIR, exist_ok=True)

def list_ftp_files():
    """Conecta al FTP y lista los archivos en el directorio de salida."""
    files = []
    try:
        with ftplib.FTP(FTP_HOST) as ftp:
            ftp.login(FTP_USER, FTP_PASS)
            ftp.cwd(FTP_SALIDA_DIR)
            files = ftp.nlst()
    except Exception as e:
        print(f"Error al listar archivos en FTP: {e}")
    return files

def download_ftp_file(filename, local_dir):
    """Descarga un archivo del FTP al directorio local indicado."""
    local_path = os.path.join(local_dir, filename)
    try:
        with ftplib.FTP(FTP_HOST) as ftp:
            ftp.login(FTP_USER, FTP_PASS)
            ftp.cwd(FTP_SALIDA_DIR)
            with open(local_path, 'wb') as f:
                ftp.retrbinary(f"RETR {filename}", f.write)
        return local_path
    except Exception as e:
        print(f"Error al descargar {filename}: {e}")
        return None

def delete_ftp_file(filename):
    """Elimina un archivo del FTP para evitar reprocesarlo."""
    try:
        with ftplib.FTP(FTP_HOST) as ftp:
            ftp.login(FTP_USER, FTP_PASS)
            ftp.cwd(FTP_SALIDA_DIR)
            ftp.delete(filename)
        print(f"Archivo {filename} eliminado del FTP.")
    except Exception as e:
        print(f"Error eliminando {filename} del FTP: {e}")

def generar_xlsx_from_txt(txt_path):
    """Convierte el archivo TXT (con delimitador '|') en un XLSX."""
    try:
        with open(txt_path, 'r', encoding='utf-8') as f:
            lines = [line.strip() for line in f if line.strip()]
        data = [line.split("|") for line in lines]
        
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Pedido"
        for row in data:
            ws.append(row)
        
        xlsx_path = txt_path.rsplit(".", 1)[0] + ".xlsx"
        wb.save(xlsx_path)
        return xlsx_path
    except Exception as e:
        print(f"Error generando XLSX a partir de {txt_path}: {e}")
        return None

def enviar_correo_con_adjunto(cedula, nombres, xlsx_path):
    """Envía un correo con el archivo XLSX adjunto."""
    try:
        with open(xlsx_path, "rb") as f:
            adjunto = f.read()

        # Generar nombre de archivo para el adjunto usando fecha y hora
        now = datetime.now()
        file_timestamp = now.strftime("%Y%m%d_%H%M%S")
        nombres_limpio = "".join(c for c in nombres if c.isalnum() or c in (" ", "_")).replace(" ", "_")
        file_name = f"{cedula}_{nombres_limpio}_{file_timestamp}.xlsx"
        
        mensaje = EmailMessage()
        mensaje["Subject"] = f"Pedido Online de {nombres}"
        mensaje["From"] = SMTP_USER
        mensaje["To"] = MAIL_TO
        mensaje.set_content("Adjunto su pedido en formato XLSX.")
        mensaje.add_attachment(adjunto, maintype="application", subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=file_name)
        
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(mensaje)
        print(f"Correo enviado con el adjunto: {file_name}")
    except Exception as e:
        print(f"Error al enviar correo: {e}")

def pedidos_icompras():
    # Directorio temporal para trabajar
    temp_dir = tempfile.mkdtemp()
    
    files = list_ftp_files()
    # Filtrar pedidos: todos los archivos que terminen en .txt sin importar el nombre
    pedidos = [f for f in files if f.lower().endswith(".txt")]
    
    if not pedidos:
        print("No se encontraron pedidos nuevos en /salida.")
        return
    
    for pedido in pedidos:
        # Verificar si el pedido ya fue copiado en DEST_DIR
        dest_pedido = os.path.join(DEST_DIR, pedido)
        if os.path.exists(dest_pedido):
            print(f"El pedido {pedido} ya fue procesado. Se omite.")
            continue

        print(f"Procesando archivo: {pedido}")
        local_txt = download_ftp_file(pedido, temp_dir)
        if not local_txt:
            continue

        xlsx_path = generar_xlsx_from_txt(local_txt)
        if not xlsx_path:
            continue

        # Extraer datos del pedido para el correo; por ejemplo, se puede usar el campo CODCLI (índice 5)
        try:
            with open(local_txt, "r", encoding="utf-8") as f:
                primera_linea = f.readline().strip()
            campos = primera_linea.split("|")
            cedula = campos[5] if len(campos) > 5 else "desconocido"
        except Exception as e:
            print(f"Error al obtener datos del pedido: {e}")
            cedula = "desconocido"
        nombres = "Pedido Online"
        enviar_correo_con_adjunto(cedula, nombres, xlsx_path)
        
        # Copiar el archivo procesado a DEST_DIR para evitar duplicados en el futuro
        try:
            shutil.copy(local_txt, dest_pedido)
            print(f"Se copió el pedido a {dest_pedido}")
        except Exception as e:
            print(f"Error al copiar el pedido a {dest_pedido}: {e}")
        
        # Opcional: eliminar el archivo ya procesado del FTP
        delete_ftp_file(pedido)
    
def main():
    pedidos_icompras()

if __name__ == "__main__":
    main()