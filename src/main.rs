//! Backend da Pokédex: serve o frontend e expõe uma API REST para
//! montar e salvar um time de Pokémon em um banco SQLite.

use std::{
    env,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, put},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, services::ServeFile};

const MAX_TEAM_SIZE: i64 = 6;

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
}

// ===== Modelos =====

#[derive(Serialize)]
struct TeamMember {
    id: i64,
    pokemon_id: i64,
    name: String,
    nickname: Option<String>,
    types: Vec<String>,
    sprite: Option<String>,
    position: i64,
    created_at: String,
}

#[derive(Deserialize)]
struct NewMember {
    pokemon_id: i64,
    name: String,
    #[serde(default)]
    types: Vec<String>,
    sprite: Option<String>,
    nickname: Option<String>,
}

#[derive(Deserialize)]
struct UpdateMember {
    nickname: Option<String>,
}

#[derive(Deserialize)]
struct TeamOrder {
    ids: Vec<i64>,
}

// ===== Erros =====

enum ApiError {
    BadRequest(String),
    NotFound,
    Conflict(String),
    Internal(String),
}

impl From<rusqlite::Error> for ApiError {
    fn from(err: rusqlite::Error) -> Self {
        ApiError::Internal(err.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "Pokémon não está no time".into()),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            ApiError::Internal(msg) => {
                eprintln!("Erro interno: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Erro interno do servidor".into())
            }
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

// ===== Banco de dados =====

fn open_database(path: &str) -> rusqlite::Result<Connection> {
    if let Some(parent) = PathBuf::from(path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS team (
             id         INTEGER PRIMARY KEY AUTOINCREMENT,
             pokemon_id INTEGER NOT NULL,
             name       TEXT    NOT NULL,
             nickname   TEXT,
             types      TEXT    NOT NULL DEFAULT '[]',
             sprite     TEXT,
             position   INTEGER NOT NULL DEFAULT 0,
             created_at TEXT    NOT NULL DEFAULT (datetime('now'))
         );",
    )?;

    // Migração: bancos criados antes da reordenação não têm a coluna `position`.
    let has_position: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('team') WHERE name = 'position'",
        [],
        |r| r.get(0),
    )?;
    if !has_position {
        conn.execute_batch(
            "ALTER TABLE team ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
             UPDATE team SET position = id;",
        )?;
    }
    Ok(conn)
}

fn row_to_member(row: &Row) -> rusqlite::Result<TeamMember> {
    let types_json: String = row.get("types")?;
    Ok(TeamMember {
        id: row.get("id")?,
        pokemon_id: row.get("pokemon_id")?,
        name: row.get("name")?,
        nickname: row.get("nickname")?,
        types: serde_json::from_str(&types_json).unwrap_or_default(),
        sprite: row.get("sprite")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
    })
}

fn find_member(conn: &Connection, id: i64) -> rusqlite::Result<Option<TeamMember>> {
    conn.query_row("SELECT * FROM team WHERE id = ?1", [id], row_to_member)
        .optional()
}

fn clean_nickname(nickname: Option<String>) -> ApiResult<Option<String>> {
    let nickname = nickname
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());
    if nickname.as_ref().is_some_and(|n| n.chars().count() > 20) {
        return Err(ApiError::BadRequest("Apelido deve ter no máximo 20 caracteres".into()));
    }
    Ok(nickname)
}

// ===== Handlers =====

async fn health() -> &'static str {
    "ok"
}

// READ — lista o time
async fn list_team(State(state): State<AppState>) -> ApiResult<Json<Vec<TeamMember>>> {
    let conn = state.db.lock().unwrap();
    let mut stmt = conn.prepare("SELECT * FROM team ORDER BY position, id")?;
    let team = stmt
        .query_map([], row_to_member)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Json(team))
}

// CREATE — adiciona um Pokémon ao time
async fn add_member(
    State(state): State<AppState>,
    Json(input): Json<NewMember>,
) -> ApiResult<(StatusCode, Json<TeamMember>)> {
    if input.pokemon_id <= 0 || input.name.trim().is_empty() {
        return Err(ApiError::BadRequest("pokemon_id e name são obrigatórios".into()));
    }
    let nickname = clean_nickname(input.nickname)?;

    let conn = state.db.lock().unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM team", [], |r| r.get(0))?;
    if count >= MAX_TEAM_SIZE {
        return Err(ApiError::Conflict(format!(
            "O time já tem {MAX_TEAM_SIZE} Pokémon. Remova um para adicionar outro."
        )));
    }

    let already_in_team: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM team WHERE pokemon_id = ?1",
        [input.pokemon_id],
        |r| r.get(0),
    )?;
    if already_in_team {
        return Err(ApiError::Conflict("Esse Pokémon já está no time.".into()));
    }

    let types_json = serde_json::to_string(&input.types).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO team (pokemon_id, name, nickname, types, sprite, position)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(position), 0) + 1 FROM team))",
        params![input.pokemon_id, input.name.trim(), nickname, types_json, input.sprite],
    )?;
    let member = find_member(&conn, conn.last_insert_rowid())?.ok_or(ApiError::NotFound)?;
    Ok((StatusCode::CREATED, Json(member)))
}

// UPDATE (bônus) — altera o apelido
async fn update_member(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<UpdateMember>,
) -> ApiResult<Json<TeamMember>> {
    let nickname = clean_nickname(input.nickname)?;
    let conn = state.db.lock().unwrap();
    let changed = conn.execute(
        "UPDATE team SET nickname = ?1 WHERE id = ?2",
        params![nickname, id],
    )?;
    if changed == 0 {
        return Err(ApiError::NotFound);
    }
    let member = find_member(&conn, id)?.ok_or(ApiError::NotFound)?;
    Ok(Json(member))
}

// UPDATE — salva a nova ordem do time (arrastar e soltar)
async fn reorder_team(
    State(state): State<AppState>,
    Json(input): Json<TeamOrder>,
) -> ApiResult<Json<Vec<TeamMember>>> {
    {
        let mut conn = state.db.lock().unwrap();
        let mut current: Vec<i64> = conn
            .prepare("SELECT id FROM team")?
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut requested = input.ids.clone();
        current.sort_unstable();
        requested.sort_unstable();
        if current != requested {
            return Err(ApiError::BadRequest(
                "A nova ordem deve conter exatamente os Pokémon do time".into(),
            ));
        }

        let tx = conn.transaction()?;
        for (index, id) in input.ids.iter().enumerate() {
            tx.execute(
                "UPDATE team SET position = ?1 WHERE id = ?2",
                params![index as i64 + 1, id],
            )?;
        }
        tx.commit()?;
    }
    list_team(State(state)).await
}

// DELETE — remove um Pokémon do time
async fn remove_member(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<StatusCode> {
    let conn = state.db.lock().unwrap();
    let changed = conn.execute("DELETE FROM team WHERE id = ?1", [id])?;
    if changed == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ===== Main =====

#[tokio::main]
async fn main() {
    let port: u16 = env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
    let db_path = env::var("DB_PATH").unwrap_or_else(|_| "data/pokedex.db".into());
    let static_dir = PathBuf::from(env::var("STATIC_DIR").unwrap_or_else(|_| ".".into()));

    let conn = open_database(&db_path).expect("não foi possível abrir o banco SQLite");
    let state = AppState { db: Arc::new(Mutex::new(conn)) };

    let api = Router::new()
        .route("/health", get(health))
        .route("/team", get(list_team).post(add_member))
        .route("/team/order", put(reorder_team))
        .route("/team/{id}", patch(update_member).delete(remove_member))
        .with_state(state);

    // Serve apenas os arquivos do frontend (evita expor o banco ou o código-fonte).
    let app = Router::new()
        .nest("/api", api)
        .route_service("/", ServeFile::new(static_dir.join("index.html")))
        .route_service("/index.html", ServeFile::new(static_dir.join("index.html")))
        .route_service("/style.css", ServeFile::new(static_dir.join("style.css")))
        .route_service("/script.js", ServeFile::new(static_dir.join("script.js")))
        // Permite que o frontend no GitHub Pages converse com um backend local.
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("porta em uso");
    println!("Pokédex rodando em http://localhost:{port} (banco: {db_path})");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

// Encerra com Ctrl+C ou com o SIGTERM enviado pelo `docker stop`.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("falha ao registrar SIGTERM")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
