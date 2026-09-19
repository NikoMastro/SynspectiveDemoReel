# Build from the REPOSITORY ROOT so one .dockerignore covers every image:
#   docker build -f frontend/Dockerfile .

# ---------------------------------------------------------------- build stage
FROM node:24-alpine AS build
WORKDIR /app

# Lockfile first, so editing a component does not reinstall node_modules.
# npm ci rather than npm install: it installs exactly the lockfile and fails
# if package.json has drifted from it, which is what a build should do.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Relative, so the browser calls the nginx in front of it and nginx proxies to
# scene-service. A Cloud Run deployment would override this with the service URL.
ARG VITE_API_BASE=/api/v1
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ----------------------------------------------------------------- run stage
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
