#!/usr/bin/env python3

import subprocess
import os
import sys
import mysql.connector
import re

# --- Configuración de la Base de Datos (las variables se pasan por el cron job) ---
DB_CONFIG = {
    'host': os.getenv('DB_HOST_SFTP_CREATOR'),
    'user': os.getenv('DB_USER_SFTP_CREATOR'),
    'password': os.getenv('DB_PASSWORD_SFTP_CREATOR'),
    'database': os.getenv('DB_NAME_SFTP_CREATOR'),
    'port': 3939
}

# --- Directorio Base SFTP y Grupo ---
SFTP_BASE_DIR = "/var/sftp/clientes"
SFTP_GROUP = "sftp_users" # Asegúrate de que este grupo exista y sea el correcto

# --- Función de Sanitización ---
def _sanitize_linux_username(username):
    """
    Genera el nombre de usuario SFTP basado en el código de cliente.
    Formato: 'C' + código_cliente (preservando ceros).
    """
    if not username:
        return ""

    # Convertir a string y limpiar espacios
    clean_username = str(username).strip()
    
    # Sanitización básica: mantener solo caracteres seguros para Linux
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '', clean_username)
    
    return f"C{sanitized}"

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

def manage_sftp_users():
    print(f"[{os.getpid()}] Iniciando script de gestión de usuarios SFTP...")
    conn = None
    cursor = None
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(dictionary=True)

        # 1. Obtener todos los clientes de la base de datos que deben tener acceso SFTP (activos)
        query_active_clients = """
        SELECT
            cliente,
            ftpclave AS password_ftp
        FROM
            scli
        WHERE
            ftp = 'S';
        """
        cursor.execute(query_active_clients)
        db_active_clients_raw = cursor.fetchall()

        active_db_sftp_users = {
            _sanitize_linux_username(client['cliente']): client['password_ftp']
            for client in db_active_clients_raw
        }

        # 2. Obtener TODOS los usuarios de scli (para decidir a quién desactivar)
        query_all_clients = """
        SELECT
            cliente,
            ftp
        FROM
            scli;
        """
        cursor.execute(query_all_clients)
        all_db_client_statuses_raw = cursor.fetchall()
        
        all_db_client_statuses = {
            _sanitize_linux_username(client['cliente']): {
                'ftp': client['ftp']
            }
            for client in all_db_client_statuses_raw
        }

        # 3. Obtener usuarios SFTP existentes en el sistema (directorios en SFTP_BASE_DIR)
        existing_sftp_users_dirs = [d for d in os.listdir(SFTP_BASE_DIR) if os.path.isdir(os.path.join(SFTP_BASE_DIR, d))]

        # 4. Procesar usuarios: crear, actualizar, desactivar
        
        # Crear/Actualizar usuarios activos
        for sanitized_username, password in active_db_sftp_users.items():
            if not sanitized_username:
                print(f"[{os.getpid()}] ADVERTENCIA: Se encontró un nombre de usuario vacío después de la sanitización. Saltando.")
                continue

            user_home_dir = os.path.join(SFTP_BASE_DIR, sanitized_username)
            
             # Verificar si el usuario existe en el sistema
            user_exists_cmd = ['id', '-u', sanitized_username]
            if not _execute_command(user_exists_cmd):
                print(f"[{os.getpid()}] Creando usuario SFTP: {sanitized_username}...")
                
                # --- INICIO DEL CÓDIGO CORREGIDO ---
                # Comando de creación corregido para Fedora/RHEL
                if not _execute_command(['useradd', '--system', '--home-dir', user_home_dir, '--gid', SFTP_GROUP, '--shell', '/usr/sbin/nologin', '-M', sanitized_username]):
                    print(f"[{os.getpid()}] Falló la creación del usuario del sistema {sanitized_username}. Saltando.")
                    continue
                # --- FIN DEL CÓDIGO CORREGIDO ---
                
                # Crear el directorio chroot y la carpeta 'pedidos' y 'facturas' dentro
                if not _execute_command(['mkdir', '-p', user_home_dir]):
                    print(f"[{os.getpid()}] Falló la creación del directorio chroot {user_home_dir}. Saltando.")
                    continue
                if not _execute_command(['chown', 'root:root', user_home_dir]):
                    print(f"[{os.getpid()}] Falló la asignación de propietario {user_home_dir}. Saltando.")
                    continue
                if not _execute_command(['chmod', '755', user_home_dir]):
                    print(f"[{os.getpid()}] Falló la asignación de permisos {user_home_dir}. Saltando.")
                    continue
                    
                user_pedidos_dir = os.path.join(user_home_dir, "pedidos")
                user_facturas_dir = os.path.join(user_home_dir, "facturas")
                
                if not _execute_command(['mkdir', '-p', user_pedidos_dir]):
                    print(f"[{os.getpid()}] Falló la creación de {user_pedidos_dir}. Saltando.")
                    continue
                if not _execute_command(['chown', f"{sanitized_username}:{SFTP_GROUP}", user_pedidos_dir]):
                    print(f"[{os.getpid()}] Falló la asignación de propietario a {user_pedidos_dir}. Saltando.")
                    continue
                if not _execute_command(['chmod', '775', user_pedidos_dir]):
                    print(f"[{os.getpid()}] Falló la asignación de permisos a {user_pedidos_dir}. Saltando.")
                    continue

                if not _execute_command(['mkdir', '-p', user_facturas_dir]):
                    print(f"[{os.getpid()}] Falló la creación de {user_facturas_dir}. Saltando.")
                    continue
                if not _execute_command(['chown', f"root:{SFTP_GROUP}", user_facturas_dir]):
                    print(f"[{os.getpid()}] Falló la asignación de propietario a {user_facturas_dir}. Saltando.")
                    continue
                if not _execute_command(['chmod', '755', user_facturas_dir]):
                    print(f"[{os.getpid()}] Falló la asignación de permisos a {user_facturas_dir}. Saltando.")
                    continue

                print(f"[{os.getpid()}] Usuario SFTP '{sanitized_username}' y directorios creados exitosamente.")
                
            # Establecer o actualizar la contraseña usando 'passwd'
            print(f"[{os.getpid()}] Estableciendo/Actualizando contraseña para usuario SFTP: {sanitized_username}...")
            passwd_input = f"{password}\n{password}\n"
            if not _execute_command(['passwd', sanitized_username], input_data=passwd_input):
                print(f"[{os.getpid()}] Falló el establecimiento/actualización de contraseña para {sanitized_username}. Verifique la contraseña en la DB.")
            else:
                print(f"[{os.getpid()}] Contraseña para '{sanitized_username}' establecida/actualizada.")

            # Eliminar el directorio del usuario de la lista de existentes para saber cuáles hay que desactivar
            if sanitized_username in existing_sftp_users_dirs:
                existing_sftp_users_dirs.remove(sanitized_username)

        # Desactivar usuarios que existen en el sistema pero NO deben tener acceso SFTP
        for system_username in existing_sftp_users_dirs:
            db_status = all_db_client_statuses.get(system_username)

            if (not db_status or
                db_status['ftp'] != 'S'):
                
                print(f"[{os.getpid()}] Desactivando usuario SFTP (configuración en DB indica NO activo): {system_username}...")
                if not _execute_command(['usermod', '-L', system_username]):
                    print(f"[{os.getpid()}] Falló el bloqueo de contraseña para {system_username}.")
                else:
                    print(f"[{os.getpid()}] Usuario SFTP '{system_username}' desactivado (contraseña bloqueada).")
            
    except mysql.connector.Error as err:
        print(f"[{os.getpid()}] Error de base de datos: {err}")
        sys.exit(1)
    except Exception as e:
        print(f"[{os.getpid()}] Ocurrió un error inesperado: {e}")
        sys.exit(1)
    finally:
        if cursor:
            cursor.close()
        if conn and conn.is_connected():
            conn.close()
            print(f"[{os.getpid()}] Conexión a la DB cerrada.")
        print(f"[{os.getpid()}] Script de gestión de usuarios SFTP finalizado.")

if __name__ == "__main__":
    manage_sftp_users()