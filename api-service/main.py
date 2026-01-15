import functools
import json
import logging
import os
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import clickhouse_driver
import requests
from atproto_identity import (
    is_valid_did,
    is_valid_handle,
    pds_endpoint,
    resolve_identity,
)
from atproto_oauth import (
    fetch_authserver_meta,
    initial_token_request,
    pds_authed_req,
    refresh_token_request,
    resolve_pds_authserver,
    send_par_auth_request,
)
from atproto_security import hardened_http, is_safe_url
from authlib.common.security import generate_token
from authlib.jose import JsonWebKey, jwt
from authlib.oauth2.rfc7636 import create_s256_code_challenge
from clickhouse_pool import ClickHouseConnectionPool
from dotenv import load_dotenv
from flask import Flask, abort, g, jsonify, redirect, request, session
from flask_cors import CORS

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment setup
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(
    app,
    resources={
        r"/*": {
            "origins": "*",
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            "allow_headers": [
                "Content-Type",
                "Authorization",
                "X-Requested-With",
                "Accept",
                "Origin",
                "DPoP",
            ],
            "supports_credentials": True,
            "max_age": 86400,
        }
    },
)

# Load configuration from environment variables
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32))
app.config["CLIENT_SECRET_JWK"] = os.getenv("FLASK_CLIENT_SECRET_JWK", "")
app.config["DATABASE_URL"] = os.getenv(
    "DATABASE_URL",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "bluesky_trends.sqlite"),
)
app.config["APP_DOMAIN"] = os.getenv("APP_DOMAIN", "your-app-domain.com")
app.config["APP_BASE_URL"] = os.getenv(
    "APP_BASE_URL", f"https://{app.config['APP_DOMAIN']}"
)

# ClickHouse configuration
app.config["CLICKHOUSE_HOST"] = os.getenv("CLICKHOUSE_HOST", "localhost")
app.config["CLICKHOUSE_PORT"] = int(os.getenv("CLICKHOUSE_PORT", "9000"))
app.config["CLICKHOUSE_USER"] = os.getenv("CLICKHOUSE_USER", "default")
app.config["CLICKHOUSE_PASSWORD"] = os.getenv("CLICKHOUSE_PASSWORD", "")
app.config["CLICKHOUSE_DATABASE"] = os.getenv("CLICKHOUSE_DATABASE", "default")

# Parse client secret JWK if provided, otherwise this will be a public client
if app.config["CLIENT_SECRET_JWK"]:
    try:
        # Parse the JWK as a JSON object first
        jwk_data = json.loads(app.config["CLIENT_SECRET_JWK"])

        # Add "use" field if missing
        if "use" not in jwk_data:
            jwk_data["use"] = "sig"

        CLIENT_SECRET_JWK = JsonWebKey.import_key(jwk_data)
        CLIENT_PUB_JWK = json.loads(CLIENT_SECRET_JWK.as_json(is_private=False))

        # Check that the public JWK is really public
        assert "d" not in CLIENT_PUB_JWK

        # Add "use" field to public JWK if missing
        if "use" not in CLIENT_PUB_JWK:
            CLIENT_PUB_JWK["use"] = "sig"

        logger.info("Successfully loaded client secret JWK")
    except Exception as e:
        logger.error(f"Error loading CLIENT_SECRET_JWK: {e}")
        # Fall back to public client if JWK loading fails
        CLIENT_SECRET_JWK = None
        CLIENT_PUB_JWK = None
else:
    CLIENT_SECRET_JWK = None
    CLIENT_PUB_JWK = None


# Initialize ClickHouse client
clickhouse_client = ClickHouseConnectionPool(
    host=app.config["CLICKHOUSE_HOST"],
    port=app.config["CLICKHOUSE_PORT"],
    user=app.config["CLICKHOUSE_USER"],
    password=app.config["CLICKHOUSE_PASSWORD"],
    database=app.config["CLICKHOUSE_DATABASE"],
    pool_size=10,  # Adjust based on your expected concurrency
    max_retries=3,
    retry_delay=0.5,
)


# Add a teardown handler to clean up connections when the app shuts down
@app.teardown_appcontext
def close_clickhouse_connections(exception):
    if hasattr(g, "_clickhouse_client"):
        g._clickhouse_client.close()


# Database helpers for SQLite
def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db_path = app.config.get("DATABASE_URL")
        # Make sure the directory exists before connecting
        db_dir = os.path.dirname(db_path)
        if not os.path.exists(db_dir) and db_dir:
            os.makedirs(db_dir, exist_ok=True)
        db = g._database = sqlite3.connect(db_path, timeout=30.0)
        # Enable WAL mode for better concurrency
        db.execute("PRAGMA journal_mode=WAL")
        # Set busy timeout to wait instead of failing immediately
        db.execute("PRAGMA busy_timeout = 30000")
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


def query_db(query, args=(), one=False):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(query, args)
    rv = cur.fetchall()
    conn.commit()
    cur.close()
    return (rv[0] if rv else None) if one else rv


def init_sqlite_db():
    print("Initializing SQLite database...")
    with app.app_context():
        db = get_db()
        # Create tables for auth requests and sessions
        db.execute(
            """
        CREATE TABLE IF NOT EXISTS oauth_auth_request (
            state TEXT NOT NULL PRIMARY KEY,
            authserver_iss TEXT NOT NULL,
            did TEXT,
            handle TEXT,
            pds_url TEXT,
            pkce_verifier TEXT NOT NULL,
            scope TEXT NOT NULL,
            dpop_authserver_nonce TEXT NOT NULL,
            dpop_private_jwk TEXT NOT NULL
        )
        """
        )

        db.execute(
            """
        CREATE TABLE IF NOT EXISTS oauth_session (
            did TEXT NOT NULL PRIMARY KEY,
            handle TEXT,
            pds_url TEXT NOT NULL,
            authserver_iss TEXT NOT NULL,
            access_token TEXT,
            refresh_token TEXT,
            dpop_authserver_nonce TEXT NOT NULL,
            dpop_pds_nonce TEXT,
            dpop_private_jwk TEXT NOT NULL
        )
        """
        )

        # Create users table with metadata and push notification fields
        db.execute(
            """
        CREATE TABLE IF NOT EXISTS users (
            did TEXT NOT NULL PRIMARY KEY,
            handle TEXT NOT NULL,
            display_name TEXT,
            avatar_url TEXT,
            followed_topics TEXT,
            device_tokens TEXT,
            last_notification_time INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            preferred_tags TEXT
        )
        """
        )

        db.commit()


# Helper to ensure ClickHouse tables exist
def init_clickhouse_db():
    print("Initializing ClickHouse database...")
    # Create trends table
    # trends_schema = """
    # CREATE TABLE IF NOT EXISTS trends (
    #     keyword LowCardinality(String),
    #     post_count UInt32,
    #     post_ids Array(String),
    #     summary String,
    #     detected_at Int32,
    #     INDEX keyword_idx keyword TYPE bloom_filter(0.01)
    # )
    # ENGINE = ReplacingMergeTree(detected_at)
    # PARTITION BY toYYYYMM(fromUnixTimestamp(detected_at))
    # ORDER BY (keyword, detected_at)
    # PRIMARY KEY (keyword, detected_at)
    # SETTINGS index_granularity = 8192
    # """
    # clickhouse_client.execute(trends_schema)


# Initialize databases
init_sqlite_db()
init_clickhouse_db()


# Load user from session or token
@app.before_request
def load_logged_in_user():
    # First try to get from session
    user_did = session.get("user_did")

    # If not in session, try to get from Authorization header
    if user_did is None:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split("Bearer ")[1]
            # Look up the user by access token
            user_session = (
                get_db()
                .execute("SELECT * FROM oauth_session WHERE access_token = ?", (token,))
                .fetchone()
            )

            if user_session:
                g.user = user_session
                return

        g.user = None
    else:
        g.user = (
            get_db()
            .execute("SELECT * FROM oauth_session WHERE did = ?", (user_did,))
            .fetchone()
        )


# Login required decorator for API endpoints
def login_required(view):
    @functools.wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return (
                jsonify(
                    {"error": "Authentication required", "redirect": "/api/auth/login"}
                ),
                401,
            )
        return view(**kwargs)

    return wrapped_view


# Routes
@app.route("/api")
def api_info():
    return jsonify(
        {
            "name": "Bluesky Trends API",
            "version": "1.0.0",
            "description": "RESTful API for tracking trends on Bluesky social network",
        }
    )


# OAuth client metadata - this is necessary for Bluesky OAuth
@app.route("/oauth/client-metadata.json")
def oauth_client_metadata():
    app_url = request.url_root.rstrip("/")
    if app_url.startswith("http://"):
        app_url = "https://" + app_url[7:]
    client_id = f"{app_url}/oauth/client-metadata.json"

    metadata = {
        "client_id": client_id,
        "dpop_bound_access_tokens": True,
        "application_type": "web",
        "redirect_uris": [f"{app_url}/api/auth/callback"],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "scope": "atproto transition:generic",  # Match reference implementation
        "client_name": "Bluesky Trends API",
        "client_uri": app_url,
    }

    # If we have a client secret, include auth method details
    if CLIENT_SECRET_JWK:
        # Create a copy of the public JWK and add the required "use" field
        pub_jwk_with_use = CLIENT_PUB_JWK.copy()
        pub_jwk_with_use["use"] = "sig"  # "sig" for signature operations

        metadata.update(
            {
                "token_endpoint_auth_method": "private_key_jwt",
                "token_endpoint_auth_signing_alg": "ES256",
                "jwks": {"keys": [pub_jwk_with_use]},
            }
        )
    else:
        metadata["token_endpoint_auth_method"] = "none"

    return jsonify(metadata)


# Login API and OAuth flow initiation
@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.json
    username = data.get("username")

    # Validate that we have a username
    if not username:
        return jsonify({"error": "Username is required"}), 400

    # Handle resolution logic exactly like the reference implementation
    if is_valid_handle(username) or is_valid_did(username):
        # This is an account identifier
        login_hint = username
        try:
            did, handle, did_doc = resolve_identity(username)
            pds_url = pds_endpoint(did_doc)
            print(f"account PDS: {pds_url}")
            authserver_url = resolve_pds_authserver(pds_url)
        except Exception as err:
            print(f"Failed to resolve identity: {err}")
            return jsonify({"error": f"Failed to resolve identity: {err}"}), 400
    elif username.startswith("https://") and is_safe_url(username):
        # When starting with an auth server, we don't know about the account yet
        did, handle, pds_url = None, None, None
        login_hint = None
        # Check if this is a Resource Server (PDS) URL; otherwise assume it is authorization server
        initial_url = username
        try:
            authserver_url = resolve_pds_authserver(initial_url)
        except Exception:
            authserver_url = initial_url
    else:
        return jsonify({"error": "Not a valid handle, DID, or auth server URL"}), 400

    # Fetch auth server metadata
    print(f"account Authorization Server: {authserver_url}")
    assert is_safe_url(authserver_url)
    try:
        authserver_meta = fetch_authserver_meta(authserver_url)
    except Exception as err:
        print(f"Failed to fetch auth server metadata: {err}")
        return jsonify({"error": "Failed to fetch Auth Server OAuth metadata"}), 400

    # Generate DPoP private signing key for this session
    dpop_private_jwk = JsonWebKey.generate_key("EC", "P-256", is_private=True)

    # OAuth scopes
    scope = "atproto transition:generic"

    # Dynamically compute client details (exactly like reference)
    app_url = request.url_root.rstrip("/")
    if app_url.startswith("http://"):
        app_url = "https://" + app_url[7:]

    redirect_uri = f"{app_url}/api/auth/callback"
    client_id = f"{app_url}/oauth/client-metadata.json"

    # CUSTOM IMPLEMENTATION USING DIRECT CONTROL OF JWT
    from authlib.common.security import generate_token
    from authlib.jose import jwt
    from authlib.jose.errors import JoseError
    from authlib.oauth2.rfc7636 import create_s256_code_challenge

    # PAR endpoint from server metadata
    par_url = authserver_meta["pushed_authorization_request_endpoint"]

    # Generate state and PKCE tokens
    state = generate_token()
    pkce_verifier = generate_token(48)
    code_challenge = create_s256_code_challenge(pkce_verifier)
    code_challenge_method = "S256"

    # Create client assertion JWT
    client_assertion = None
    if CLIENT_SECRET_JWK:
        client_assertion = jwt.encode(
            {"alg": "ES256", "kid": CLIENT_SECRET_JWK["kid"]},
            {
                "iss": client_id,
                "sub": client_id,
                "aud": authserver_url,
                "jti": generate_token(),
                "iat": int(time.time()),
            },
            CLIENT_SECRET_JWK,
        ).decode("utf-8")

    # Get DPoP private key details
    dpop_authserver_nonce = ""
    dpop_pub_jwk = json.loads(dpop_private_jwk.as_json(is_private=False))

    # Directly use PyJWT which gives more control over the headers
    import jwt as pyjwt

    # Create DPoP claims
    dpop_claims = {
        "jti": generate_token(),
        "htm": "POST",
        "htu": par_url,
        "iat": int(time.time()),
        "exp": int(time.time()) + 30,
    }

    # Extract the key in a format PyJWT can use
    private_key_dict = json.loads(dpop_private_jwk.as_json(is_private=True))

    try:
        # Try first with PyJWT which gives better header control
        import base64

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        # This is complex, but we need to get the EC key in a format PyJWT can use
        # Convert the JWK formatted key to a PEM key
        d_base64 = private_key_dict["d"].encode("ascii")
        d_bytes = base64.urlsafe_b64decode(d_base64 + b"=" * (4 - len(d_base64) % 4))
        x_base64 = private_key_dict["x"].encode("ascii")
        x_bytes = base64.urlsafe_b64decode(x_base64 + b"=" * (4 - len(x_base64) % 4))
        y_base64 = private_key_dict["y"].encode("ascii")
        y_bytes = base64.urlsafe_b64decode(y_base64 + b"=" * (4 - len(y_base64) % 4))

        private_numbers = ec.EllipticCurvePrivateNumbers(
            private_value=int.from_bytes(d_bytes, byteorder="big"),
            public_numbers=ec.EllipticCurvePublicNumbers(
                x=int.from_bytes(x_bytes, byteorder="big"),
                y=int.from_bytes(y_bytes, byteorder="big"),
                curve=ec.SECP256R1(),
            ),
        )
        private_key = private_numbers.private_key()

        # Convert to PEM format
        pem_private_key = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

        # Create the DPoP proof using PyJWT with explicit headers
        dpop_proof = pyjwt.encode(
            payload=dpop_claims,
            key=pem_private_key,
            algorithm="ES256",
            headers={
                "typ": "dpop+jwt",  # This is the critical part
                "jwk": dpop_pub_jwk,
            },
        )

        # If returned as bytes, decode to string
        if isinstance(dpop_proof, bytes):
            dpop_proof = dpop_proof.decode("utf-8")

        # Verify the header is correct
        header_part = dpop_proof.split(".")[0]
        header_padding = header_part + "=" * (4 - len(header_part) % 4)
        decoded_header = base64.urlsafe_b64decode(
            header_padding.encode("utf-8")
        ).decode("utf-8")
        print(f"Encoded DPoP Header (PyJWT): {decoded_header}")

    except Exception as e:
        print(f"PyJWT approach failed: {e}")
        # Fall back to a direct JWT encoding if the PyJWT approach fails

        # Create a custom JWT encoder class that forces the header
        from authlib.common.encoding import json_dumps, to_bytes, urlsafe_b64encode
        from authlib.jose.jwk import ECKey

        # Manually construct the JWT
        header = {"typ": "dpop+jwt", "alg": "ES256", "jwk": dpop_pub_jwk}
        header_segment = (
            urlsafe_b64encode(json_dumps(header).encode("utf-8"))
            .decode("utf-8")
            .rstrip("=")
        )
        payload_segment = (
            urlsafe_b64encode(json_dumps(dpop_claims).encode("utf-8"))
            .decode("utf-8")
            .rstrip("=")
        )

        # Signing input
        signing_input = f"{header_segment}.{payload_segment}"

        # Sign with ECKey
        key = ECKey(private_key_dict)
        signature = key.sign(to_bytes(signing_input))

        # Encode the signature
        signature_segment = urlsafe_b64encode(signature).decode("utf-8").rstrip("=")

        # Final JWT
        dpop_proof = f"{header_segment}.{payload_segment}.{signature_segment}"

        # Verify the header is correct
        import base64

        header_padding = header_segment + "=" * (4 - len(header_segment) % 4)
        decoded_header = base64.urlsafe_b64decode(
            header_padding.encode("utf-8")
        ).decode("utf-8")
        print(f"Encoded DPoP Header (manual): {decoded_header}")

    # Prepare PAR request body
    par_body = {
        "response_type": "code",
        "code_challenge": code_challenge,
        "code_challenge_method": code_challenge_method,
        "client_id": client_id,
        "state": state,
        "redirect_uri": redirect_uri,
        "scope": scope,
    }

    if login_hint:
        par_body["login_hint"] = login_hint

    # Add client assertion if we have a client secret
    if client_assertion:
        par_body["client_assertion_type"] = (
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
        )
        par_body["client_assertion"] = client_assertion

    print("PAR URL: ", par_url)
    print(
        "Headers: ",
        {
            "Content-Type": "application/x-www-form-urlencoded",
            "DPoP": dpop_proof[:50] + "...",
        },
    )
    print("Body: ", par_body)

    # Send the PAR request
    import requests

    resp = requests.post(
        par_url,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "DPoP": dpop_proof,
        },
        data=par_body,
    )

    # Handle DPoP nonce error
    if resp.status_code == 400 and resp.json().get("error") == "use_dpop_nonce":
        dpop_authserver_nonce = resp.headers["DPoP-Nonce"]
        print(f"Retrying with new auth server DPoP nonce: {dpop_authserver_nonce}")

        # Update claims with nonce and regenerate the JWT
        dpop_claims["nonce"] = dpop_authserver_nonce

        try:
            # Try PyJWT again with updated claims
            dpop_proof = pyjwt.encode(
                payload=dpop_claims,
                key=pem_private_key,
                algorithm="ES256",
                headers={"typ": "dpop+jwt", "jwk": dpop_pub_jwk},
            )

            # If returned as bytes, decode to string
            if isinstance(dpop_proof, bytes):
                dpop_proof = dpop_proof.decode("utf-8")
        except:
            # Fall back to manual encoding
            payload_segment = (
                urlsafe_b64encode(json_dumps(dpop_claims).encode("utf-8"))
                .decode("utf-8")
                .rstrip("=")
            )
            signing_input = f"{header_segment}.{payload_segment}"
            signature = key.sign(to_bytes(signing_input))
            signature_segment = urlsafe_b64encode(signature).decode("utf-8").rstrip("=")
            dpop_proof = f"{header_segment}.{payload_segment}.{signature_segment}"

        # Retry the request
        resp = requests.post(
            par_url,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "DPoP": dpop_proof,
            },
            data=par_body,
        )

    # Handle error responses
    if resp.status_code == 400:
        print(f"PAR HTTP 400: {resp.json()}")
        return jsonify({"error": f"Authorization request failed: {resp.json()}"}), 400

    if resp.status_code == 401:
        print(f"PAR HTTP 401: {resp.json() if resp.content else 'No content'}")
        return (
            jsonify(
                {
                    "error": "Authorization server rejected client credentials",
                    "details": resp.json(),
                }
            ),
            401,
        )

    # Check for successful response
    try:
        resp.raise_for_status()
        par_request_uri = resp.json()["request_uri"]
    except Exception as e:
        print(f"PAR request failed with status {resp.status_code}: {str(e)}")
        if resp.content:
            print(f"Response content: {resp.content.decode('utf-8')}")
        return jsonify({"error": f"Failed to get PAR request URI: {str(e)}"}), 500

    # Save auth request in database exactly like reference
    print(f"Saving oauth_auth_request to DB state={state}")
    query_db(
        "INSERT INTO oauth_auth_request (state, authserver_iss, did, handle, pds_url, pkce_verifier, scope, dpop_authserver_nonce, dpop_private_jwk) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?);",
        [
            state,
            authserver_meta["issuer"],
            did,  # might be None
            handle,  # might be None
            pds_url,  # might be None
            pkce_verifier,
            scope,
            dpop_authserver_nonce,
            dpop_private_jwk.as_json(is_private=True),
        ],
    )

    # Return the auth URL for the client to redirect to
    auth_url = authserver_meta["authorization_endpoint"]
    assert is_safe_url(auth_url)
    qparam = urlencode({"client_id": client_id, "request_uri": par_request_uri})
    auth_url_with_params = f"{auth_url}?{qparam}"

    return jsonify({"success": True, "auth_url": auth_url_with_params, "state": state})


@app.route("/api/auth/status")
def auth_status():
    state = request.args.get("state")

    if not state:
        return jsonify({"error": "Missing state parameter"}), 400

    # Check if this state has been authenticated
    auth_request = query_db(
        "SELECT * FROM oauth_auth_request WHERE state = ?", [state], one=True
    )

    if not auth_request:
        return (
            jsonify({"authenticated": False, "message": "Auth request not found"}),
            404,
        )

    # Convert to dict
    auth_request_dict = dict(auth_request)

    # Check for associated session
    user_session = query_db(
        "SELECT * FROM oauth_session WHERE did = ?",
        [auth_request_dict["did"]],
        one=True,
    )

    if user_session:
        # Convert to dict
        user_session_dict = dict(user_session)

        # User is authenticated
        user_data = {
            "did": user_session_dict["did"],
            "handle": user_session_dict["handle"],
            "access_token": user_session_dict["access_token"],
            "refresh_token": user_session_dict["refresh_token"],
        }

        # Get additional user info if available
        user_profile = query_db(
            "SELECT * FROM users WHERE did = ?", [user_session_dict["did"]], one=True
        )

        if user_profile:
            # Convert to dict
            user_profile_dict = dict(user_profile)

            user_data.update(
                {
                    "display_name": user_profile_dict.get("display_name"),
                    "avatar_url": user_profile_dict.get("avatar_url"),
                    "followed_topics": (
                        user_profile_dict.get("followed_topics", "").split(",")
                        if user_profile_dict.get("followed_topics")
                        else []
                    ),
                }
            )

        return jsonify({"authenticated": True, "user": user_data})
    else:
        # Not authenticated yet
        return jsonify({"authenticated": False, "message": "Not authenticated yet"})


@app.route("/api/auth/callback")
def auth_callback():
    state = request.args.get("state")
    authserver_iss = request.args.get("iss")
    authorization_code = request.args.get("code")

    if not all([state, authserver_iss, authorization_code]):
        return render_auth_error("Missing required OAuth parameters")

    # Look up auth request by state
    row = query_db(
        "SELECT * FROM oauth_auth_request WHERE state = ?;",
        [state],
        one=True,
    )
    if row is None:
        return render_auth_error("OAuth request not found")

    # Delete row to prevent replay
    query_db("DELETE FROM oauth_auth_request WHERE state = ?;", [state])

    # Verify issuer matches
    if row["authserver_iss"] != authserver_iss:
        return render_auth_error("Authorization server mismatch")

    if row["state"] != state:
        return render_auth_error("State parameter mismatch")

    # Exchange code for tokens
    app_url = request.url_root.rstrip("/")
    if app_url.startswith("http://"):
        app_url = "https://" + app_url[7:]

    try:
        # Use the same approach as in the login route for consistency
        from authlib.jose import jwt

        # Get auth server metadata
        authserver_meta = fetch_authserver_meta(authserver_iss)
        token_url = authserver_meta["token_endpoint"]

        # Construct token request fields
        client_id = f"{app_url}/oauth/client-metadata.json"
        redirect_uri = f"{app_url}/api/auth/callback"

        # Self-signed JWT for client authentication
        client_assertion = None
        if CLIENT_SECRET_JWK:
            from authlib.common.security import generate_token

            client_assertion = jwt.encode(
                {"alg": "ES256", "kid": CLIENT_SECRET_JWK["kid"]},
                {
                    "iss": client_id,
                    "sub": client_id,
                    "aud": authserver_iss,
                    "jti": generate_token(),
                    "iat": int(time.time()),
                },
                CLIENT_SECRET_JWK,
            ).decode("utf-8")

        # Prepare token request parameters
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code": authorization_code,
            "code_verifier": row["pkce_verifier"],
        }

        if client_assertion:
            params["client_assertion_type"] = (
                "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
            )
            params["client_assertion"] = client_assertion

        # Create DPoP JWT for token request
        dpop_private_jwk = JsonWebKey.import_key(json.loads(row["dpop_private_jwk"]))
        dpop_authserver_nonce = row["dpop_authserver_nonce"]

        # Create DPoP JWT with PyJWT with explicit header
        import base64

        import jwt as pyjwt
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        # Get DPoP private key details
        dpop_pub_jwk = json.loads(dpop_private_jwk.as_json(is_private=False))
        private_key_dict = json.loads(dpop_private_jwk.as_json(is_private=True))

        # Create DPoP claims
        dpop_claims = {
            "jti": generate_token(),
            "htm": "POST",
            "htu": token_url,
            "iat": int(time.time()),
            "exp": int(time.time()) + 30,
        }

        if dpop_authserver_nonce:
            dpop_claims["nonce"] = dpop_authserver_nonce

        # Convert JWK to PEM format for PyJWT
        d_base64 = private_key_dict["d"].encode("ascii")
        d_bytes = base64.urlsafe_b64decode(d_base64 + b"=" * (4 - len(d_base64) % 4))
        x_base64 = private_key_dict["x"].encode("ascii")
        x_bytes = base64.urlsafe_b64decode(x_base64 + b"=" * (4 - len(x_base64) % 4))
        y_base64 = private_key_dict["y"].encode("ascii")
        y_bytes = base64.urlsafe_b64decode(y_base64 + b"=" * (4 - len(y_base64) % 4))

        private_numbers = ec.EllipticCurvePrivateNumbers(
            private_value=int.from_bytes(d_bytes, byteorder="big"),
            public_numbers=ec.EllipticCurvePublicNumbers(
                x=int.from_bytes(x_bytes, byteorder="big"),
                y=int.from_bytes(y_bytes, byteorder="big"),
                curve=ec.SECP256R1(),
            ),
        )
        private_key = private_numbers.private_key()

        # Convert to PEM format
        pem_private_key = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )

        # Create the DPoP proof with explicit headers
        dpop_proof = pyjwt.encode(
            payload=dpop_claims,
            key=pem_private_key,
            algorithm="ES256",
            headers={"typ": "dpop+jwt", "jwk": dpop_pub_jwk},  # This must be dpop+jwt
        )

        # If returned as bytes, decode to string
        if isinstance(dpop_proof, bytes):
            dpop_proof = dpop_proof.decode("utf-8")

        # Verify header format
        header_part = dpop_proof.split(".")[0]
        header_padding = header_part + "=" * (4 - len(header_part) % 4)
        decoded_header = base64.urlsafe_b64decode(
            header_padding.encode("utf-8")
        ).decode("utf-8")
        print(f"Token exchange DPoP header: {decoded_header}")

        # Make the token request
        import requests

        resp = requests.post(token_url, data=params, headers={"DPoP": dpop_proof})

        # Handle DPoP nonce error by retrying
        if resp.status_code == 400 and resp.json().get("error") == "use_dpop_nonce":
            dpop_authserver_nonce = resp.headers["DPoP-Nonce"]
            print(f"Retrying token exchange with nonce: {dpop_authserver_nonce}")

            # Update claims with nonce
            dpop_claims["nonce"] = dpop_authserver_nonce

            # Regenerate DPoP proof
            dpop_proof = pyjwt.encode(
                payload=dpop_claims,
                key=pem_private_key,
                algorithm="ES256",
                headers={"typ": "dpop+jwt", "jwk": dpop_pub_jwk},
            )

            if isinstance(dpop_proof, bytes):
                dpop_proof = dpop_proof.decode("utf-8")

            # Retry the request
            resp = requests.post(token_url, data=params, headers={"DPoP": dpop_proof})

        # Check for errors
        if resp.status_code != 200:
            print(f"Token exchange error: {resp.status_code} - {resp.text}")
            return render_auth_error(f"Token exchange failed: {resp.text}")

        # Parse the token response
        tokens = resp.json()

        # Verify account
        if row["did"]:
            # If we started with an account ID, verify match
            did, handle, pds_url = row["did"], row["handle"], row["pds_url"]
            if tokens["sub"] != did:
                return render_auth_error("Account DID mismatch")
        else:
            # Otherwise, resolve from the received token
            did = tokens["sub"]
            if not is_valid_did(did):
                return render_auth_error("Invalid DID in token")

            did, handle, did_doc = resolve_identity(did)
            pds_url = pds_endpoint(did_doc)
            authserver_url = resolve_pds_authserver(pds_url)

            # Verify auth server matches
            if authserver_url != authserver_iss:
                return render_auth_error("Auth server mismatch")

        # Verify scope
        if row["scope"] != tokens["scope"]:
            return render_auth_error("Scope mismatch")

        # Save session in database
        print(f"Saving oauth_session to DB: {did}")
        query_db(
            "INSERT OR REPLACE INTO oauth_session (did, handle, pds_url, authserver_iss, access_token, refresh_token, dpop_authserver_nonce, dpop_pds_nonce, dpop_private_jwk) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?);",
            [
                did,
                handle,
                pds_url,
                authserver_iss,
                tokens["access_token"],
                tokens["refresh_token"],
                dpop_authserver_nonce,
                "",  # Empty default for dpop_pds_nonce
                row["dpop_private_jwk"],
            ],
        )

        # Fetch user's profile information
        try:
            profile_data = fetch_user_profile(
                did,
                pds_url,
                tokens["access_token"],
                row["dpop_private_jwk"],
                dpop_authserver_nonce,
            )

            now = int(time.time())
            # Check if user already exists
            existing_user = query_db(
                "SELECT * FROM users WHERE did = ?", [did], one=True
            )

            if existing_user:
                # Update existing user
                query_db(
                    """
                    UPDATE users SET
                    handle = ?,
                    display_name = ?,
                    avatar_url = ?,
                    updated_at = ?
                    WHERE did = ?
                    """,
                    [
                        handle,
                        profile_data.get("displayName", ""),
                        profile_data.get("avatar", ""),
                        now,
                        did,
                    ],
                )
            else:
                # Create new user
                query_db(
                    """
                    INSERT INTO users
                    (did, handle, display_name, avatar_url, followed_topics, device_tokens, last_notification_time, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        did,
                        handle,
                        profile_data.get("displayName", ""),
                        profile_data.get("avatar", ""),
                        "",  # Empty followed topics
                        "",  # Empty device tokens
                        0,  # No notifications sent yet
                        now,
                        now,
                    ],
                )
        except Exception as e:
            logger.error(f"Error fetching user profile: {e}")
            # Continue with login even if profile fetch fails

        # Set session cookie
        session["user_did"] = did
        session["user_handle"] = handle

        # Check if this is a mobile client requesting JSON
        if (
            request.args.get("mobile") == "true"
            or request.headers.get("Accept") == "application/json"
        ):
            # Return JSON response for mobile clients
            user_data = {
                "did": did,
                "handle": handle,
                "display_name": "",
                "avatar_url": "",
                "followed_topics": [],
                "access_token": tokens["access_token"],
                "refresh_token": tokens["refresh_token"],
                "expires_at": int(time.time()) + tokens.get("expires_in", 3600),
            }

            try:
                user_profile = query_db(
                    "SELECT * FROM users WHERE did = ?", [did], one=True
                )
                if user_profile:
                    user_profile_dict = dict(user_profile)
                    user_data["display_name"] = user_profile_dict.get(
                        "display_name", ""
                    )
                    user_data["avatar_url"] = user_profile_dict.get("avatar_url", "")
                    if user_profile_dict.get("followed_topics"):
                        user_data["followed_topics"] = user_profile_dict.get(
                            "followed_topics", ""
                        ).split(",")
            except Exception:
                pass

            return jsonify({"authenticated": True, "user": user_data})
        else:
            # Return HTML page for web clients
            handle_display = handle or did
            avatar_url = ""
            display_name = ""

            try:
                user_profile = query_db(
                    "SELECT * FROM users WHERE did = ?", [did], one=True
                )
                if user_profile:
                    user_profile_dict = dict(user_profile)
                    display_name = user_profile_dict.get("display_name", "")
                    avatar_url = user_profile_dict.get("avatar_url", "")
            except Exception:
                pass

            return render_auth_success(handle_display, display_name, avatar_url)

    except Exception as e:
        import traceback

        print(f"Token exchange exception: {str(e)}")
        print(traceback.format_exc())
        return render_auth_error(f"Authentication error: {str(e)}")


import os

from jinja2 import Environment, FileSystemLoader

# Set up Jinja2 environment
template_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
env = Environment(loader=FileSystemLoader(template_dir))


# Helper function to render auth success HTML
def render_auth_success(handle, display_name="", avatar_url=""):
    display_name = display_name or handle
    template = env.get_template("auth_success.html")
    return template.render(
        handle=handle, display_name=display_name, avatar_url=avatar_url
    )


# Helper function to render auth error HTML
def render_auth_error(error_message):
    template = env.get_template("auth_error.html")
    return template.render(error_message=error_message)


# Refresh token handler
@app.route("/api/auth/refresh", methods=["POST"])
@login_required
def auth_refresh():
    app_url = request.url_root.rstrip("/")
    if app_url.startswith("http://"):
        app_url = "https://" + app_url[7:]

    try:
        tokens, dpop_authserver_nonce = refresh_token_request(
            g.user, app_url, CLIENT_SECRET_JWK
        )

        # Update tokens in database - preserve dpop_pds_nonce if it exists
        current_pds_nonce = g.user.get("dpop_pds_nonce", "")
        query_db(
            "UPDATE oauth_session SET access_token = ?, refresh_token = ?, dpop_authserver_nonce = ?, dpop_pds_nonce = ? WHERE did = ?;",
            [
                tokens["access_token"],
                tokens["refresh_token"],
                dpop_authserver_nonce,
                current_pds_nonce,
                g.user["did"],
            ],
        )

        return jsonify({"success": True, "message": "Token refreshed successfully"})
    except Exception as e:
        return jsonify({"error": f"Failed to refresh token: {str(e)}"}), 500


# Logout
@app.route("/api/auth/logout", methods=["POST"])
@login_required
def auth_logout():
    try:
        query_db("DELETE FROM oauth_session WHERE did = ?;", [g.user["did"]])
        session.clear()
        return jsonify({"success": True, "message": "Logged out successfully"})
    except Exception as e:
        return jsonify({"error": f"Error during logout: {str(e)}"}), 500


# Helper function to fetch user profile from Bluesky
def fetch_user_profile(did, pds_url, access_token, dpop_private_jwk_json, dpop_nonce):
    """Fetch user profile data from Bluesky"""
    # For PoC use the public Bluesky API
    logger.info(f"Using public Bluesky API to fetch profile for {did}")

    # Use the handle from the oauth session to fetch profile
    session_row = query_db(
        "SELECT handle FROM oauth_session WHERE did = ?", [did], one=True
    )

    if not session_row or not session_row["handle"]:
        logger.error(f"No handle found for DID: {did}")
        # Return minimal profile data
        return {
            "did": did,
            "handle": did.split(":")[-1],
            "displayName": did.split(":")[-1],
        }

    handle = session_row["handle"]
    public_api_url = "https://api.bsky.app/xrpc/app.bsky.actor.getProfile"

    try:
        response = requests.get(public_api_url, params={"actor": handle})
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"Error fetching profile from public API: {e}")
        # Return minimal profile data on error
        return {"did": did, "handle": handle, "displayName": handle.split(".")[0]}


# User Profile Management
@app.route("/api/profile", methods=["GET"])
@login_required
def get_user_profile():
    user_data = query_db("SELECT * FROM users WHERE did = ?", [g.user["did"]], one=True)

    if not user_data:
        return jsonify({"error": "User profile not found"}), 404

    # Convert row to dict
    user = {
        "did": user_data["did"],
        "handle": user_data["handle"],
        "display_name": user_data["display_name"],
        "avatar_url": user_data["avatar_url"],
        "followed_topics": (
            user_data["followed_topics"].split(",")
            if user_data["followed_topics"]
            else []
        ),
        "preferred_tags": (
            user_data["preferred_tags"].split(",")
            if user_data["preferred_tags"]
            else []
        ),
        "created_at": user_data["created_at"],
        "updated_at": user_data["updated_at"],
    }

    return jsonify({"user": user})


@app.route("/api/profile", methods=["PUT"])
@login_required
def update_user_profile():
    data = request.json

    # Validate input
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # Get followed topics if provided
    followed_topics = None
    if "followed_topics" in data:
        if not isinstance(data["followed_topics"], list):
            return jsonify({"error": "followed_topics must be an array"}), 400
        followed_topics = ",".join(data["followed_topics"])

    # Get preferred tags if provided
    preferred_tags = None
    if "preferred_tags" in data:
        if not isinstance(data["preferred_tags"], list):
            return jsonify({"error": "preferred_tags must be an array"}), 400
        preferred_tags = ",".join(data["preferred_tags"])

    # Get current user data
    user_data = query_db("SELECT * FROM users WHERE did = ?", [g.user["did"]], one=True)

    if not user_data:
        return jsonify({"error": "User not found"}), 404

    # Update only the fields that were provided
    updates = []
    params = []

    if followed_topics is not None:
        updates.append("followed_topics = ?")
        params.append(followed_topics)

    if preferred_tags is not None:
        updates.append("preferred_tags = ?")
        params.append(preferred_tags)

    if "device_token" in data and data["device_token"]:
        # Get existing device tokens
        if user_data["device_tokens"]:
            existing_tokens = user_data["device_tokens"].split(",")
        else:
            existing_tokens = []

        # Add new token if it's not already in the list
        if data["device_token"] not in existing_tokens:
            existing_tokens.append(data["device_token"])

        updates.append("device_tokens = ?")
        params.append(",".join(existing_tokens))

    # Only proceed if there are updates
    if updates:
        updates.append("updated_at = ?")
        params.append(int(time.time()))

        # Add the did for WHERE clause
        params.append(g.user["did"])

        # Perform the update
        query_db(f"UPDATE users SET {', '.join(updates)} WHERE did = ?", params)

        return jsonify({"success": True, "message": "Profile updated successfully"})
    else:
        return jsonify({"message": "No changes made to profile"})


# Trends API
@app.route("/api/trends")
def get_trends():
    # Get time window parameter
    window_hours = request.args.get("window", 24, type=int)
    if window_hours <= 0 or window_hours > 72:
        window_hours = 24

    # Get tag filters (support both single tag and multiple tags)
    tag_filter = request.args.get("tag", None)
    tags_filter = request.args.get("tags", None)
    filter_mode = request.args.get("filter_mode", "any").lower()  # 'any' or 'all'

    # Parse tag filters
    tag_list = []
    if tags_filter:
        # Multiple tags parameter takes precedence
        tag_list = [tag.strip() for tag in tags_filter.split(",") if tag.strip()]
    elif tag_filter:
        # Fall back to single tag parameter for backward compatibility
        tag_list = [tag_filter]

    # Calculate time window
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=window_hours)

    # Convert to Unix timestamps
    start_timestamp = int(start_time.timestamp())
    end_timestamp = int(end_time.timestamp())

    # Query ClickHouse for trends
    if tag_list:
        # Build query conditions based on filter mode
        if filter_mode == "all":
            # All tags must be present (AND logic)
            # Changed hasElement to has
            tag_conditions = " AND ".join(
                [f"has(tags, %(tag{i})s)" for i in range(len(tag_list))]
            )
            query = f"""
            SELECT
                keyword,
                post_count,
                summary,
                detected_at,
                post_ids,
                tags
            FROM trends
            WHERE detected_at BETWEEN %(start_ts)s AND %(end_ts)s
              AND {tag_conditions}
            ORDER BY post_count DESC
            LIMIT 30
            """
        else:
            # Any tag can be present (OR logic)
            # Changed hasElement to has
            tag_conditions = " OR ".join(
                [f"has(tags, %(tag{i})s)" for i in range(len(tag_list))]
            )
            query = f"""
            SELECT
                keyword,
                post_count,
                summary,
                detected_at,
                post_ids,
                tags
            FROM trends
            WHERE detected_at BETWEEN %(start_ts)s AND %(end_ts)s
              AND ({tag_conditions})
            ORDER BY post_count DESC
            LIMIT 30
            """
    else:
        # Return all trends
        query = """
        SELECT
            keyword,
            post_count,
            summary,
            detected_at,
            post_ids,
            tags
        FROM trends
        WHERE detected_at BETWEEN %(start_ts)s AND %(end_ts)s
        ORDER BY post_count DESC
        LIMIT 30
        """

    try:
        params = {"start_ts": start_timestamp, "end_ts": end_timestamp}
        # Add tag parameters for the query
        if tag_list:
            for i, tag in enumerate(tag_list):
                params[f"tag{i}"] = tag

        results = clickhouse_client.execute(
            query,
            params,
            with_column_types=True,
        )

        # Process results
        rows, columns = results
        trends_data = []

        for row in rows:
            keyword, post_count, summary, detected_at, post_ids, tags = row
            trends_data.append(
                {
                    "keyword": keyword,
                    "post_count": post_count,
                    "summary": summary,
                    "detected_at": datetime.fromtimestamp(detected_at).isoformat(),
                    "post_ids": post_ids,
                    "tags": tags if tags else [],
                    "matches_tags": (
                        tag_list if tag_list else []
                    ),  # Include the tags that were used for filtering
                }
            )

        return jsonify(
            {
                "trends": trends_data,
                "window_hours": window_hours,
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "filter": {"tags": tag_list, "mode": filter_mode if tag_list else None},
            }
        )
    except Exception as e:
        logger.error(f"Error fetching trends: {e}")
        return jsonify({"error": f"Failed to fetch trends: {str(e)}"}), 500


# API endpoint to get all tags used in trends
@app.route("/api/tags")
def get_all_tags():
    # Calculate time window - default to last 7 days
    window_days = request.args.get("window", 7, type=int)
    if window_days <= 0 or window_days > 30:
        window_days = 7

    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=window_days)

    # Convert to Unix timestamps
    start_timestamp = int(start_time.timestamp())
    end_timestamp = int(end_time.timestamp())

    # Query ClickHouse for all tags
    query = """
    SELECT
        arrayJoin(tags) as tag,
        COUNT(*) as count
    FROM trends
    WHERE detected_at BETWEEN %(start_ts)s AND %(end_ts)s
      AND length(tags) > 0
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 50
    """

    try:
        results = clickhouse_client.execute(
            query,
            {"start_ts": start_timestamp, "end_ts": end_timestamp},
            with_column_types=True,
        )

        # Process results
        rows, columns = results
        tags_data = []

        for row in rows:
            tag, count = row
            if tag:  # Skip empty tags
                tags_data.append({"tag": tag, "count": count})

        return jsonify(
            {
                "tags": tags_data,
                "window_days": window_days,
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
            }
        )
    except Exception as e:
        logger.error(f"Error fetching tags: {e}")
        return jsonify({"error": f"Failed to fetch tags: {str(e)}"}), 500


# API endpoint to get trend history for a specific keyword
@app.route("/api/trends/<keyword>/history")
def trend_history(keyword):
    # Get parameters
    start_time_str = request.args.get("start")
    end_time_str = request.args.get("end")

    # Parse timestamps
    try:
        if start_time_str:
            start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
        else:
            start_time = datetime.now(timezone.utc) - timedelta(days=7)

        if end_time_str:
            end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))
        else:
            end_time = datetime.now(timezone.utc)
    except ValueError:
        return jsonify({"error": "Invalid timestamp format"}), 400

    # Validate time range
    if start_time > end_time:
        return jsonify({"error": "Start time must be before end time"}), 400

    # Convert to Unix timestamps
    start_timestamp = int(start_time.timestamp())
    end_timestamp = int(end_time.timestamp())

    # Query ClickHouse for trend history
    query = """
    SELECT
        keyword,
        post_count,
        summary,
        detected_at,
        post_ids,
        tags
    FROM trends
    WHERE keyword = %(keyword)s AND detected_at BETWEEN %(start_ts)s AND %(end_ts)s
    ORDER BY detected_at
    """

    try:
        results = clickhouse_client.execute(
            query,
            {"keyword": keyword, "start_ts": start_timestamp, "end_ts": end_timestamp},
            with_column_types=True,
        )

        # Process results
        rows, columns = results
        trends_data = []

        for row in rows:
            keyword, post_count, summary, detected_at, post_ids, tags = row
            trends_data.append(
                {
                    "keyword": keyword,
                    "post_count": post_count,
                    "summary": summary,
                    "detected_at": datetime.fromtimestamp(detected_at).isoformat(),
                    "post_ids": post_ids,
                    "tags": tags if tags else [],
                }
            )

        return jsonify(
            {
                "keyword": keyword,
                "history": trends_data,
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
            }
        )
    except Exception as e:
        logger.error(f"Error fetching trend history: {e}")
        return jsonify({"error": f"Failed to fetch trend history: {str(e)}"}), 500


# API to register for push notifications
@app.route("/api/notifications/register", methods=["POST"])
@login_required
def register_for_notifications():
    data = request.json
    device_token = data.get("device_token")

    if not device_token:
        return jsonify({"error": "Device token is required"}), 400

    # Get user data
    user_data = query_db("SELECT * FROM users WHERE did = ?", [g.user["did"]], one=True)

    # Get existing tokens
    if user_data and user_data["device_tokens"]:
        existing_tokens = user_data["device_tokens"].split(",")
    else:
        existing_tokens = []

    # Add new token if not already in the list
    if device_token not in existing_tokens:
        existing_tokens.append(device_token)

    # Update user data
    query_db(
        "UPDATE users SET device_tokens = ?, updated_at = ? WHERE did = ?",
        [",".join(existing_tokens), int(time.time()), g.user["did"]],
    )

    return jsonify({"success": True})


# Enhanced topic system endpoints


# Topic schema - create it if it doesn't exist
def init_topics_tables():
    print("Initializing topic tables...")
    with app.app_context():
        db = get_db()
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS topics (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                trend_count INTEGER DEFAULT 0,
                follower_count INTEGER DEFAULT 0,
                image_url TEXT,
                related_topics TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS topic_follows (
                user_did TEXT,
                topic_id TEXT,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (user_did, topic_id),
                FOREIGN KEY (user_did) REFERENCES users (did) ON DELETE CASCADE,
                FOREIGN KEY (topic_id) REFERENCES topics (id) ON DELETE CASCADE
            )
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS topic_trends (
                topic_id TEXT,
                trend_keyword TEXT,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (topic_id, trend_keyword),
                FOREIGN KEY (topic_id) REFERENCES topics (id) ON DELETE CASCADE
            )
            """
        )

        db.commit()


# Initialize topic tables
init_topics_tables()


# Get topics list with pagination
@app.route("/api/topics")
def get_topics():
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 20, type=int)
    search_query = request.args.get("q", "", type=str)

    offset = (page - 1) * page_size

    # Build query conditions
    query_conditions = []
    query_params = []

    if search_query:
        query_conditions.append("(name LIKE ? OR description LIKE ?)")
        query_params.extend([f"%{search_query}%", f"%{search_query}%"])

    # Construct final query
    where_clause = (
        " WHERE " + " AND ".join(query_conditions) if query_conditions else ""
    )

    # Get total count
    count_result = query_db(
        f"SELECT COUNT(*) as total FROM topics{where_clause}", query_params, one=True
    )
    total = dict(count_result)["total"] if count_result else 0

    # Get paginated results
    topics_results = query_db(
        f"""
        SELECT
            id, name, description, trend_count, follower_count,
            image_url, related_topics, created_at, updated_at
        FROM topics{where_clause}
        ORDER BY follower_count DESC, name ASC
        LIMIT ? OFFSET ?
        """,
        query_params + [page_size, offset],
    )

    topics = []
    for topic in topics_results:
        topic_dict = dict(topic)
        # Parse related topics from comma-separated string
        if topic_dict["related_topics"]:
            topic_dict["related_topics"] = topic_dict["related_topics"].split(",")
        else:
            topic_dict["related_topics"] = []

        topics.append(topic_dict)

    return jsonify(
        {"topics": topics, "total": total, "page": page, "pageSize": page_size}
    )


# Get popular topics
@app.route("/api/topics/popular")
def get_popular_topics():
    limit = request.args.get("limit", 10, type=int)

    topics_results = query_db(
        """
        SELECT
            id, name, description, trend_count, follower_count,
            image_url, related_topics, created_at, updated_at
        FROM topics
        ORDER BY follower_count DESC
        LIMIT ?
        """,
        [limit],
    )

    topics = []
    for topic in topics_results:
        topic_dict = dict(topic)
        # Parse related topics from comma-separated string
        if topic_dict["related_topics"]:
            topic_dict["related_topics"] = topic_dict["related_topics"].split(",")
        else:
            topic_dict["related_topics"] = []

        topics.append(topic_dict)

    return jsonify({"topics": topics})


# Search topics
@app.route("/api/topics/search")
def search_topics():
    query = request.args.get("q", "", type=str)
    limit = request.args.get("limit", 20, type=int)

    if not query:
        return jsonify({"error": "Search query is required"}), 400

    topics_results = query_db(
        """
        SELECT
            id, name, description, trend_count, follower_count,
            image_url, related_topics, created_at, updated_at
        FROM topics
        WHERE name LIKE ? OR description LIKE ?
        ORDER BY
            CASE WHEN name LIKE ? THEN 1
                 WHEN name LIKE ? THEN 2
                 ELSE 3
            END,
            follower_count DESC
        LIMIT ?
        """,
        [f"%{query}%", f"%{query}%", f"{query}%", f"%{query}", limit],
    )

    topics = []
    for topic in topics_results:
        topic_dict = dict(topic)
        # Parse related topics from comma-separated string
        if topic_dict["related_topics"]:
            topic_dict["related_topics"] = topic_dict["related_topics"].split(",")
        else:
            topic_dict["related_topics"] = []

        topics.append(topic_dict)

    return jsonify({"topics": topics})


# Get topic details
@app.route("/api/topics/<topic_id>")
def get_topic_detail(topic_id):
    # Get topic details
    topic_result = query_db(
        """
        SELECT
            id, name, description, trend_count, follower_count,
            image_url, related_topics, created_at, updated_at
        FROM topics
        WHERE id = ?
        """,
        [topic_id],
        one=True,
    )

    if not topic_result:
        return jsonify({"error": "Topic not found"}), 404

    topic_dict = dict(topic_result)

    # Parse related topics from comma-separated string
    if topic_dict["related_topics"]:
        topic_dict["related_topics"] = topic_dict["related_topics"].split(",")
    else:
        topic_dict["related_topics"] = []

    # Get related trends
    time_window = int(time.time()) - (24 * 3600)  # Last 24 hours

    # First get trend keywords for this topic
    trend_keywords = query_db(
        """
        SELECT trend_keyword
        FROM topic_trends
        WHERE topic_id = ?
        """,
        [topic_id],
    )

    trend_keyword_list = [dict(kw)["trend_keyword"] for kw in trend_keywords]

    trends_data = []

    if trend_keyword_list:
        # Format the IN clause placeholder string with the right number of parameters
        placeholders = ",".join(["?"] * len(trend_keyword_list))

        # Now query ClickHouse for these trends
        query = f"""
        SELECT
            keyword,
            MAX(post_count) as post_count,
            argMax(summary, detected_at) as summary,
            MAX(detected_at) as detected_at,
            argMax(post_ids, detected_at) as post_ids
        FROM trends
        WHERE keyword IN ({placeholders}) AND detected_at > %(time_ago)s
        GROUP BY keyword
        ORDER BY post_count DESC
        LIMIT 20
        """

        try:
            results = clickhouse_client.execute(
                query, trend_keyword_list + [time_window], with_column_types=True
            )

            rows, columns = results

            for row in rows:
                keyword, post_count, summary, detected_at, post_ids, tags = row
                trends_data.append(
                    {
                        "keyword": keyword,
                        "post_count": post_count,
                        "summary": summary,
                        "detected_at": datetime.fromtimestamp(detected_at).isoformat(),
                        "post_ids": post_ids,
                        "tags": tags if tags else [],
                        "topics": [topic_dict["name"]],
                    }
                )
        except Exception as e:
            logger.error(f"Error fetching trends for topic: {e}")

    return jsonify({"topic": topic_dict, "trends": trends_data})


# Get trends for a specific topic
@app.route("/api/topics/<topic_id>/trends")
def get_topic_trends(topic_id):
    limit = request.args.get("limit", 10, type=int)
    time_window = int(time.time()) - (24 * 3600)  # Last 24 hours

    # Check if topic exists
    topic_result = query_db(
        "SELECT id, name FROM topics WHERE id = ?", [topic_id], one=True
    )

    if not topic_result:
        return jsonify({"error": "Topic not found"}), 404

    topic_dict = dict(topic_result)

    # Get trend keywords for this topic
    trend_keywords = query_db(
        """
        SELECT trend_keyword
        FROM topic_trends
        WHERE topic_id = ?
        """,
        [topic_id],
    )

    trend_keyword_list = [dict(kw)["trend_keyword"] for kw in trend_keywords]

    trends_data = []

    if trend_keyword_list:
        # Format the IN clause placeholder string with the right number of parameters
        placeholders = ",".join(["?"] * len(trend_keyword_list))

        # Now query ClickHouse for these trends
        query = f"""
        SELECT
            keyword,
            MAX(post_count) as post_count,
            argMax(summary, detected_at) as summary,
            MAX(detected_at) as detected_at,
            argMax(post_ids, detected_at) as post_ids
        FROM trends
        WHERE keyword IN ({placeholders}) AND detected_at > %(time_ago)s
        GROUP BY keyword
        ORDER BY post_count DESC
        LIMIT ?
        """

        try:
            results = clickhouse_client.execute(
                query, trend_keyword_list + [time_window, limit], with_column_types=True
            )

            rows, columns = results

            for row in rows:
                keyword, post_count, summary, detected_at, post_ids, tags = row
                trends_data.append(
                    {
                        "keyword": keyword,
                        "post_count": post_count,
                        "summary": summary,
                        "detected_at": datetime.fromtimestamp(detected_at).isoformat(),
                        "post_ids": post_ids,
                        "tags": tags if tags else [],
                        "topics": [topic_dict["name"]],
                    }
                )
        except Exception as e:
            logger.error(f"Error fetching trends for topic: {e}")

    return jsonify(
        {
            "trends": trends_data,
            "window_hours": 24,
            "start_time": datetime.fromtimestamp(time_window).isoformat(),
            "end_time": datetime.fromtimestamp(int(time.time())).isoformat(),
        }
    )


# Get related topics
@app.route("/api/topics/<topic_id>/related")
def get_related_topics(topic_id):
    # Get topic details including related topics
    topic_result = query_db(
        "SELECT related_topics FROM topics WHERE id = ?", [topic_id], one=True
    )

    if not topic_result:
        return jsonify({"error": "Topic not found"}), 404

    related_topic_ids = []
    if topic_result["related_topics"]:
        related_topic_ids = topic_result["related_topics"].split(",")

    topics = []

    if related_topic_ids:
        # Format the IN clause placeholder string with the right number of parameters
        placeholders = ",".join(["?"] * len(related_topic_ids))

        topics_results = query_db(
            f"""
            SELECT
                id, name, description, trend_count, follower_count,
                image_url, related_topics, created_at, updated_at
            FROM topics
            WHERE id IN ({placeholders})
            ORDER BY follower_count DESC
            """,
            related_topic_ids,
        )

        for topic in topics_results:
            topic_dict = dict(topic)
            if topic_dict["related_topics"]:
                topic_dict["related_topics"] = topic_dict["related_topics"].split(",")
            else:
                topic_dict["related_topics"] = []

            topics.append(topic_dict)

    return jsonify({"topics": topics})


# Follow a topic
@app.route("/api/topics/<topic_id>/follow", methods=["POST"])
@login_required
def follow_specific_topic(topic_id):
    # Check if topic exists
    topic_result = query_db("SELECT id FROM topics WHERE id = ?", [topic_id], one=True)

    if not topic_result:
        return jsonify({"error": "Topic not found"}), 404

    # Check if already following
    follow_result = query_db(
        "SELECT * FROM topic_follows WHERE user_did = ? AND topic_id = ?",
        [g.user["did"], topic_id],
        one=True,
    )

    if follow_result:
        return jsonify({"message": "Already following this topic"}), 200

    # Add follow record
    current_time = int(time.time())
    query_db(
        "INSERT INTO topic_follows (user_did, topic_id, created_at) VALUES (?, ?, ?)",
        [g.user["did"], topic_id, current_time],
    )

    # Update follower count
    query_db(
        "UPDATE topics SET follower_count = follower_count + 1, updated_at = ? WHERE id = ?",
        [current_time, topic_id],
    )

    # Get topic name to update user's followed_topics list
    topic_name_result = query_db(
        "SELECT name FROM topics WHERE id = ?", [topic_id], one=True
    )

    if topic_name_result:
        topic_name = dict(topic_name_result)["name"]

        # Get current followed topics
        user_data = query_db(
            "SELECT followed_topics FROM users WHERE did = ?", [g.user["did"]], one=True
        )

        followed_topics = []
        if user_data and user_data["followed_topics"]:
            followed_topics = user_data["followed_topics"].split(",")

        # Add topic if not already in list
        if topic_name not in followed_topics:
            followed_topics.append(topic_name)
            topics_str = ",".join(followed_topics)

            # Update user's followed topics
            query_db(
                "UPDATE users SET followed_topics = ?, updated_at = ? WHERE did = ?",
                [topics_str, current_time, g.user["did"]],
            )

    return jsonify({"success": True})


# Unfollow a topic
@app.route("/api/topics/<topic_id>/unfollow", methods=["POST"])
@login_required
def unfollow_topic(topic_id):
    # Check if topic exists
    topic_result = query_db(
        "SELECT id, name FROM topics WHERE id = ?", [topic_id], one=True
    )

    if not topic_result:
        return jsonify({"error": "Topic not found"}), 404

    topic_dict = dict(topic_result)

    # Check if following
    follow_result = query_db(
        "SELECT * FROM topic_follows WHERE user_did = ? AND topic_id = ?",
        [g.user["did"], topic_id],
        one=True,
    )

    if not follow_result:
        return jsonify({"message": "Not following this topic"}), 200

    # Remove follow record
    current_time = int(time.time())
    query_db(
        "DELETE FROM topic_follows WHERE user_did = ? AND topic_id = ?",
        [g.user["did"], topic_id],
    )

    # Update follower count
    query_db(
        "UPDATE topics SET follower_count = MAX(0, follower_count - 1), updated_at = ? WHERE id = ?",
        [current_time, topic_id],
    )

    # Update user's followed topics list
    user_data = query_db(
        "SELECT followed_topics FROM users WHERE did = ?", [g.user["did"]], one=True
    )

    if user_data and user_data["followed_topics"]:
        followed_topics = user_data["followed_topics"].split(",")

        # Remove topic from list
        if topic_dict["name"] in followed_topics:
            followed_topics.remove(topic_dict["name"])
            topics_str = ",".join(followed_topics)

            # Update user's followed topics
            query_db(
                "UPDATE users SET followed_topics = ?, updated_at = ? WHERE did = ?",
                [topics_str, current_time, g.user["did"]],
            )

    return jsonify({"success": True})


# Legacy API to update followed topics - now enhanced to manage the topic_follows table
@app.route("/api/topics/follow", methods=["POST"])
@login_required
def follow_topics():
    data = request.json
    topics = data.get("topics", [])

    if not isinstance(topics, list):
        return jsonify({"error": "Topics must be an array"}), 400

    # Create comma-separated list of topics
    topics_str = ",".join(topics)

    # Update user data
    current_time = int(time.time())
    query_db(
        "UPDATE users SET followed_topics = ?, updated_at = ? WHERE did = ?",
        [topics_str, current_time, g.user["did"]],
    )

    # Get current user's followed topics from topic_follows
    current_follows = query_db(
        """
        SELECT t.id, t.name
        FROM topics t
        JOIN topic_follows tf ON t.id = tf.topic_id
        WHERE tf.user_did = ?
        """,
        [g.user["did"]],
    )

    current_topic_names = {dict(topic)["name"] for topic in current_follows}
    current_topic_ids = {dict(topic)["id"] for topic in current_follows}

    # Topics to add (in provided list but not in current follows)
    topics_to_add = set(topics) - current_topic_names

    # Topics to remove (in current follows but not in provided list)
    topics_to_remove = current_topic_names - set(topics)

    # First handle new topics - check if they exist, if not create them
    for topic_name in topics_to_add:
        # Check if topic exists
        topic_result = query_db(
            "SELECT id FROM topics WHERE name = ?", [topic_name], one=True
        )

        topic_id = None

        if topic_result:
            # Topic exists
            topic_id = dict(topic_result)["id"]
        else:
            # Create new topic
            import uuid

            topic_id = str(uuid.uuid4())

            query_db(
                """
                INSERT INTO topics (
                    id, name, description, trend_count, follower_count,
                    image_url, related_topics, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    topic_id,
                    topic_name,
                    f"Topics related to {topic_name}",
                    0,
                    0,
                    None,
                    None,
                    current_time,
                    current_time,
                ],
            )

        # Add follow relationship
        query_db(
            "INSERT OR IGNORE INTO topic_follows (user_did, topic_id, created_at) VALUES (?, ?, ?)",
            [g.user["did"], topic_id, current_time],
        )

        # Update follower count
        query_db(
            "UPDATE topics SET follower_count = follower_count + 1, updated_at = ? WHERE id = ?",
            [current_time, topic_id],
        )

    # Now handle topics to remove
    if topics_to_remove:
        # Get topic IDs for names to remove
        for topic_name in topics_to_remove:
            # Find topic ID
            topic_result = query_db(
                "SELECT id FROM topics WHERE name = ?", [topic_name], one=True
            )

            if topic_result:
                topic_id = dict(topic_result)["id"]

                # Remove follow relationship
                query_db(
                    "DELETE FROM topic_follows WHERE user_did = ? AND topic_id = ?",
                    [g.user["did"], topic_id],
                )

                # Update follower count
                query_db(
                    "UPDATE topics SET follower_count = MAX(0, follower_count - 1), updated_at = ? WHERE id = ?",
                    [current_time, topic_id],
                )

    return jsonify({"success": True})


# Health check endpoint
@app.route("/health")
def health_check():
    try:
        # Check SQLite
        query_db("SELECT 1")

        # Check ClickHouse
        clickhouse_client.execute("SELECT 1")

        return jsonify({"status": "ok"})
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


# Background task for sending push notifications
def send_push_notifications():
    """
    Push notifications are now handled by the send_notifications.py script,
    which is run as a scheduled task via cron.

    See send_notifications.py for the implementation.
    """
    # Import and call function from send_notifications.py for manual testing
    try:
        from send_notifications import process_notifications

        logger.info("Running notification processing from API")
        process_notifications()
    except Exception as e:
        logger.error(f"Error processing notifications: {e}")

    return jsonify({"status": "Processing notifications"})


# Error handlers
@app.errorhandler(404)
def not_found_error(e):
    return jsonify({"error": "Not found", "message": str(e)}), 404


@app.errorhandler(400)
def bad_request_error(e):
    return jsonify({"error": "Bad request", "message": str(e)}), 400


@app.errorhandler(401)
def unauthorized_error(e):
    return jsonify({"error": "Unauthorized", "message": str(e)}), 401


@app.errorhandler(500)
def internal_server_error(e):
    return jsonify({"error": "Internal server error", "message": str(e)}), 500


# Main entry point
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    app.run(host="0.0.0.0", port=port, debug=True)
