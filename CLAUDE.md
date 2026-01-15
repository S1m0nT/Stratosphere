# Stratosphere - Bluesky Trend Detection Platform

## Project Overview
Stratosphere is a real-time trend detection system for Bluesky that identifies emerging topics through firehose ingestion, entity extraction, and trend analysis. The system comprises Rust microservices for ingestion, processing, and analysis, a Python/Flask API, and a React Native mobile frontend.

## Build/Test/Lint Commands
- Build all: `just build` or `pnpm turbo build`
- Development: `just dev` or `pnpm turbo dev`
- Format: `just fmt` (Rust) and `pnpm format` (JS/TS)
- Lint: `just lint` (Rust) and `pnpm turbo lint` (JS/TS) 
- Test all: `just test`
- Single Rust test: `cargo test -p <package_name> -- <test_name>`
- Frontend type check: `cd frontend && pnpm type-check`
- Start infrastructure: `docker compose up -d`
- Reset database: `just reset-db`

## Code Style Guidelines
- **Rust**: Use rustfmt + Clippy; snake_case for variables/functions/modules; CamelCase for types
- **JS/TS**: Prettier + ESLint with universe preset; camelCase for variables/functions; PascalCase for components
- **Errors**: Custom Error types with thiserror (see common/src/error.rs)
- **Imports**: Group by: (1) standard library, (2) external crates/packages, (3) local modules
- **Documentation**: Document public APIs with comments; explain complex implementations
- **Testing**: Write unit tests for business logic and integration tests for service endpoints

## Architecture 
The system follows a microservice architecture with async message passing via NATS JetStream:
- **Ingestion**: Connects to Bluesky firehose API, filters posts, publishes to message queue
- **Processing**: Extracts entities using NER, tokenizes and stores in ClickHouse
- **Analysis**: Detects trends, generates summaries, filters inappropriate content
- **API**: Serves data to frontend, handles authentication and user preferences
- **Frontend**: Mobile app displaying trends with filtering, authentication, and notifications