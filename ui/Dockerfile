FROM node:18-slim

WORKDIR /app

# Installation des dépendances
COPY package.json ./
COPY package-lock.json ./
RUN npm install --legacy-peer-deps

# Copie du code source minimal
COPY vite.config.ts ./
COPY svelte.config.js ./
COPY tsconfig.json ./
COPY src/ src/
COPY static/ static/
COPY .svelte-kit/ .svelte-kit/

# Port exposé pour Vite
EXPOSE 5173

# Commande de démarrage avec les bonnes options pour le hot-reload
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"] 