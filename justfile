# Default recipe to display available commands
default:
    @just --list

# Load .env file if it exists
# set dotenv-load

# Shell settings - using sh for better cross-platform compatibility
set shell := ["sh", "-uc"]

# Common variables
NATS_PORT := "4222"
CLICKHOUSE_PORT := "8123"
API_PORT := "3001"

# # Get the appropriate package manager command based on OS
# NPM_CMD := if os() == "windows" { "npm.cmd" } else { "npm" }
# PNPM_CMD := if os() == "windows" { "pnpm.cmd" } else { "pnpm" }
# TURBO_CMD := if os() == "windows" { "turbo.cmd" } else { "turbo" }

# Install development dependencies
install-deps:
    #!/usr/bin/env sh
    echo "Installing development dependencies..."

    # Install Rust tools
    if ! command -v cargo-watch >/dev/null 2>&1; then
        cargo install cargo-watch
    fi

    if ! command -v cargo-add >/dev/null 2>&1; then
        cargo install cargo-edit
    fi

    # Install Node.js tools
    if ! command -v pnpm >/dev/null 2>&1; then
        npm install -g pnpm
    fi

    if ! command -v turbo >/dev/null 2>&1; then
        npm install -g turbo
    fi

    # Install project dependencies
    pnpm install

    # Install Rust components
    rustup component add clippy rustfmt

    echo "Dependencies installed successfully"

# Start development environment
dev: install-deps
    #!/usr/bin/env sh
    echo "Starting development environment..."

    # Start infrastructure
    docker compose up -d nats clickhouse

    # Start all services using Turbo
    echo "Starting services..."
    pnpm turbo run dev

# Build all services
build:
    echo "Building all services..."
    pnpm turbo run build

# Run tests
test:
    echo "Running tests..."
    cargo test --all
    pnpm turbo run test

# Format code
fmt:
    echo "Formatting code..."
    cargo fmt --all

# Lint code
lint:
    echo "Linting code..."
    cargo clippy --all-targets --all-features --fix --allow-dirty --allow-staged

# Clean build artifacts
clean:
    echo "Cleaning build artifacts..."
    cargo clean
    rm -rf node_modules
    rm -rf **/node_modules

# Stop all services and clean up
down:
    echo "Stopping services..."
    docker compose down
    docker compose rm -f

# Reset everything (clean slate)
reset: down clean
    #!/usr/bin/env sh
    echo "Resetting environment..."
    docker volume rm stratosphere_clickhouse-data 2>/dev/null || true
    docker volume rm stratosphere_nats-data 2>/dev/null || true
    rm -f .env
    echo "Reset complete"

# Check system health
health:
    #!/usr/bin/env sh
    echo "Checking system health..."
    curl -f http://localhost:{{API_PORT}}/healthz || (echo "API is not healthy" && exit 1)
    echo "API health check complete"

# View logs
logs *FLAGS:
    docker compose logs {{FLAGS}}

# Deploy NER service
deploy-ner:
    #!/usr/bin/env sh
    echo "Deploying NER service..."

    if ! command -v docker >/dev/null 2>&1; then
        echo "Docker is required but not installed"
        exit 1
    fi

    echo "Logging into registry..."
    docker login registry.cloud.cbh.kth.se -u robot\$deploy-c86de5a0-0f93-4a91-a973-1c990bd3c69b+ner-api -p U6T85qBX6VO7fPNGqOAxnLqlpUzYDNbT

    echo "Building NER API image..."
    docker buildx build --platform linux/amd64 \
        -t registry.cloud.cbh.kth.se/deploy-c86de5a0-0f93-4a91-a973-1c990bd3c69b/ner-api \
        -f processing-service/NERAPI/Dockerfile \
        --push .

# Test NER locally
test-ner:
    curl -X POST http://localhost:8000/process \
        -H "Content-Type: application/json" \
        -d '{"texts": [{"text": "Google and Microsoft are investing heavily in AI technology. #ArtificialIntelligence", "metadata": {"source": "test"}}]}'

# Test NER in production
test-ner-prod:
    curl -X POST https://ner-api.app.cloud.cbh.kth.se/process \
        -H "Content-Type: application/json" \
        -d '{"texts": [{"text": "Google and Microsoft are investing heavily in AI technology. #ArtificialIntelligence", "metadata": {"source": "test"}}]}'

# Deploy duplicate detection service
deploy-dup:
    #!/usr/bin/env sh
    echo "Deploying duplicate detection service..."

    if ! command -v docker >/dev/null 2>&1; then
        echo "Docker is required but not installed"
        exit 1
    fi

    echo "Logging into registry..."
    docker login registry.cloud.cbh.kth.se -u robot\$deploy-193361a4-ba10-4567-88b7-d1854583d655+dup-api -p 4X7ZAOZuPZqKXpFbg2fkT1HdmL1V2D8x

    echo "Building duplicate detection image..."
    docker buildx build --platform linux/amd64 \
        -t registry.cloud.cbh.kth.se/deploy-193361a4-ba10-4567-88b7-d1854583d655/dup-api \
        -f analysis-service/DuplicateDetectionAPI/Dockerfile \
        --push .

# Test duplicate detection locally
test-dup:
    # TODO: implement

# Test duplicate detection in production
test-dup-prod:
    # TODO: implement

# Reset database
reset-db:
    #!/usr/bin/env sh
    echo "Resetting database..."
    echo "DROP TABLE IF EXISTS posts" | curl 'http://localhost:{{CLICKHOUSE_PORT}}/' --data-binary @-
    echo "DROP TABLE IF EXISTS entities" | curl 'http://localhost:{{CLICKHOUSE_PORT}}/' --data-binary @-
    echo "DROP TABLE IF EXISTS trends" | curl 'http://localhost:{{CLICKHOUSE_PORT}}/' --data-binary @-
    echo "Database reset complete"

# Update dependencies
update-deps:
    #!/usr/bin/env sh
    echo "Updating dependencies..."
    cargo update
    pnpm update
    echo "Dependencies updated"
