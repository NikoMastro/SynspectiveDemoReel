# One Dockerfile for both services: they share every dependency and differ only
# in which cmd/ package is the entrypoint, so SERVICE picks that at build time.
#
# Build from the REPOSITORY ROOT, not from backend/:
#   docker build -f backend/Dockerfile --build-arg SERVICE=scene-service .
# The services read fixtures/tle_strix.txt, which lives above backend/.

# ---------------------------------------------------------------- build stage
FROM golang:1.25-alpine AS build
WORKDIR /src

# Dependencies first, in their own layer. An ordinary code change then reuses
# the cached module download instead of re-fetching the whole module graph.
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./

ARG SERVICE
# CGO off gives a statically linked binary, which is what lets the final stage
# be scratch. -trimpath keeps build paths out of the binary; -s -w drop the
# symbol table and DWARF data, which is most of the size saving.
RUN test -n "$SERVICE" || (echo "build arg SERVICE is required" && exit 1) && \
    CGO_ENABLED=0 GOOS=linux go build \
      -trimpath -ldflags="-s -w" \
      -o /out/service ./cmd/"$SERVICE"

# ----------------------------------------------------------------- run stage
FROM scratch

# Not needed today - scene-service reaches flightdyn-service over plain HTTP -
# but a future outbound HTTPS call (fetching TLEs from Celestrak, say) would
# fail with an unhelpful x509 error without these, and they cost 200 kB.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

COPY --from=build /out/service /service

# Seed data, baked in so the image runs with no volume. Both paths are then
# pinned by environment variables because the defaults are relative to backend/.
# The quicklook directory sits next to scenes.json because the catalog names
# its images relative to itself.
COPY backend/testdata/scenes.json /data/scenes.json
COPY backend/testdata/quicklook/  /data/quicklook/
COPY fixtures/tle_strix.txt       /data/tle_strix.txt
ENV SCENE_FILE=/data/scenes.json \
    TLE_FILE=/data/tle_strix.txt

# Numeric because scratch has no /etc/passwd to resolve a name against.
# 65534 is nobody. Nothing here needs to write to disk.
USER 65534:65534

ENTRYPOINT ["/service"]
