# Usar la imagen oficial de Bun en su versión Alpine (ligera)
FROM oven/bun:alpine

# Definir directorio de trabajo
WORKDIR /app

# Copiar archivos de configuración
COPY package*.json ./

# Instalar dependencias con Bun (rápido y sin bloqueos de seguridad nativos)
RUN bun install

# Copiar el resto del código del proyecto
COPY . .

# Exponer el puerto de tu API
EXPOSE 7030

# Ejecutar el script "start" de tu package.json usando Bun
CMD ["bun", "run", "start"]
