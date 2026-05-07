#!/usr/bin/env python3

import os
import time
import shutil

# --- Configuration ---
SFTP_BASE_DIR = "/var/sftp/clientes"
TARGET_FILE_TYPE = ".txt"
MAX_FILE_SIZE_MB = 1
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024 # Convert MB to bytes

# Directory to move valid files to (e.g., for further processing)
VALID_FILES_PROCESSING_DIR = "/opt/sftp_processed_files"
# Directory to move invalid files to (for review, not deletion immediately)
INVALID_FILES_QUARANTINE_DIR = "/opt/sftp_quarantined_files"

# Ensure processing and quarantine directories exist
os.makedirs(VALID_FILES_PROCESSING_DIR, exist_ok=True)
os.makedirs(INVALID_FILES_QUARANTINE_DIR, exist_ok=True)

def validate_and_move_files():
    print(f"[{os.getpid()}] Iniciando script de validación de archivos SFTP...")

    # Iterate through each client's 'pedidos' directory
    for client_dir_name in os.listdir(SFTP_BASE_DIR):
        client_pedidos_path = os.path.join(SFTP_BASE_DIR, client_dir_name, "pedidos")

        if not os.path.isdir(client_pedidos_path):
            continue # Skip if 'pedidos' directory doesn't exist for some reason

        print(f"[{os.getpid()}] Procesando directorio: {client_pedidos_path}")

        for filename in os.listdir(client_pedidos_path):
            file_path = os.path.join(client_pedidos_path, filename)

            if os.path.isfile(file_path):
                file_size = os.path.getsize(file_path)
                file_extension = os.path.splitext(filename)[1].lower() # Get extension and convert to lowercase

                is_valid_type = (file_extension == TARGET_FILE_TYPE)
                is_valid_size = (file_size <= MAX_FILE_SIZE_BYTES)

                if is_valid_type and is_valid_size:
                    print(f"[{os.getpid()}] Archivo válido encontrado: {filename} (Tamaño: {file_size} bytes)")
                    # Move to valid processing directory
                    try:
                        shutil.move(file_path, os.path.join(VALID_FILES_PROCESSING_DIR, filename))
                        print(f"[{os.getpid()}] Movido '{filename}' a '{VALID_FILES_PROCESSING_DIR}'.")
                    except Exception as e:
                        print(f"[{os.getpid()}] ERROR: No se pudo mover el archivo válido '{filename}': {e}")
                else:
                    print(f"[{os.getpid()}] Archivo NO válido encontrado: {filename}")
                    print(f"[{os.getpid()}]   - Tipo válido ({TARGET_FILE_TYPE}): {is_valid_type}")
                    print(f"[{os.getpid()}]   - Tamaño válido (<{MAX_FILE_SIZE_MB}MB): {is_valid_size} (Actual: {file_size} bytes)")
                    # Move to quarantine directory (for review)
                    try:
                        shutil.move(file_path, os.path.join(INVALID_FILES_QUARANTINE_DIR, filename))
                        print(f"[{os.getpid()}] Movido '{filename}' a cuarentena '{INVALID_FILES_QUARANTINE_DIR}'.")
                    except Exception as e:
                        print(f"[{os.getpid()}] ERROR: No se pudo mover el archivo inválido '{filename}' a cuarentena: {e}")
            else:
                # This might be a subdirectory within 'pedidos', skip it
                print(f"[{os.getpid()}] Skipeando: {file_path} (no es un archivo regular)")

    print(f"[{os.getpid()}] Script de validación finalizado.")

if __name__ == "__main__":
    validate_and_move_files()