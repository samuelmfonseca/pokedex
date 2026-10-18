# ===== Etapa 1: compila o backend Rust =====
FROM rust:1-slim-bookworm AS builder
WORKDIR /app

# Compila só as dependências primeiro (fica em cache entre builds)
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs \
    && cargo build --release \
    && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

# ===== Etapa 2: imagem final enxuta =====
FROM debian:bookworm-slim
WORKDIR /app

COPY --from=builder /app/target/release/pokedex /usr/local/bin/pokedex
COPY index.html style.css script.js ./public/

ENV PORT=80 \
    DB_PATH=/app/data/pokedex.db \
    STATIC_DIR=/app/public

# O banco SQLite fica em um volume para sobreviver à recriação do container
VOLUME ["/app/data"]
EXPOSE 80

CMD ["pokedex"]
