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
# The unprivileged variant: the official nginx image runs its master process as
# root to bind port 80, which this container has no need to do. This one runs as
# uid 101 throughout and listens on 8080 instead.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# Anything in /etc/nginx/templates is run through envsubst at container start by
# the official image's entrypoint, so SCENE_URL is resolved then rather than
# baked in here. One image, two environments.
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
# Not under templates/: the entrypoint runs envsubst over everything in there,
# and this file contains $ characters that are nginx variables, not shell ones.
COPY frontend/security-headers.conf /etc/nginx/security-headers.conf
ENV SCENE_URL=http://scene:8080
EXPOSE 8080
