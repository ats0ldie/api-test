FROM node:22

# Instalar utilidades del sistema y Python para los scripts auxiliares
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias de Python usadas en los scripts
RUN pip3 install mysql-connector-python openpyxl --break-system-packages

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm install

# Copiar el código fuente
COPY . .

# Exponer el puerto
EXPOSE 7030

# Iniciar la aplicación
CMD ["node", "index.js"]