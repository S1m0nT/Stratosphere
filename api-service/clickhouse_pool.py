import queue
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import clickhouse_driver


class ClickHouseConnectionPool:
    """A simple connection pool for ClickHouse."""

    def __init__(
        self,
        host: str,
        port: int,
        user: str,
        password: str,
        database: str,
        pool_size: int = 5,
        max_retries: int = 3,
        retry_delay: float = 0.5,
    ):
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.database = database
        self.pool_size = pool_size
        self.max_retries = max_retries
        self.retry_delay = retry_delay

        self.pool = queue.Queue(maxsize=pool_size)
        self.lock = threading.RLock()
        self.connections_created = 0

        # Initialize pool with connections
        self._initialize_pool()

    def _initialize_pool(self) -> None:
        """Initialize the connection pool with connections."""
        for _ in range(self.pool_size):
            try:
                connection = self._create_connection()
                self.pool.put(connection)
            except Exception as e:
                print(f"Failed to create initial connection: {e}")

    def _create_connection(self) -> clickhouse_driver.Client:
        """Create a new ClickHouse connection."""
        with self.lock:
            self.connections_created += 1
            connection_name = f"conn-{self.connections_created}"

            return clickhouse_driver.Client(
                host=self.host,
                port=self.port,
                user=self.user,
                password=self.password,
                database=self.database,
                # Use the standard parameter names for ClickHouse driver
                settings={
                    "max_execution_time": 60,  # 60 seconds timeout
                    "connect_timeout": 10,
                    "receive_timeout": 30,
                    "send_timeout": 30,
                },
            )

    def _get_connection(self) -> clickhouse_driver.Client:
        """Get a connection from the pool or create a new one if needed."""
        try:
            # Try to get a connection from the pool
            connection = self.pool.get(block=False)
            return connection
        except queue.Empty:
            # If pool is empty, create a new connection
            return self._create_connection()

    def _return_connection(self, connection: clickhouse_driver.Client) -> None:
        """Return a connection to the pool."""
        try:
            # Only return to pool if we're under the pool size
            if self.pool.qsize() < self.pool_size:
                self.pool.put(connection, block=False)
            else:
                # Otherwise discard it
                del connection
        except queue.Full:
            # If the pool is full, discard the connection
            del connection

    def execute(
        self, query: str, params: Any = None, with_column_types: bool = False
    ) -> Any:
        """Execute a query with retry logic."""
        last_exception = None

        for attempt in range(self.max_retries):
            connection = None
            try:
                connection = self._get_connection()

                # Check if connection is still valid by executing a simple query
                try:
                    connection.execute("SELECT 1")
                except Exception:
                    # Connection is invalid, create a new one
                    connection = self._create_connection()

                # Execute the query
                result = connection.execute(
                    query, params, with_column_types=with_column_types
                )

                # Return connection to pool and return result
                self._return_connection(connection)
                return result

            except Exception as e:
                last_exception = e
                print(f"Query attempt {attempt+1} failed: {e}")

                # If we have a connection, don't return it to the pool since it might be broken
                if connection:
                    try:
                        del connection
                    except:
                        pass

                # Wait before retrying
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay * (2**attempt))  # Exponential backoff

        # If we've exhausted all retries, raise the last exception
        raise Exception(
            f"Query failed after {self.max_retries} attempts: {last_exception}"
        )

    def close(self) -> None:
        """Close all connections in the pool."""
        while not self.pool.empty():
            try:
                connection = self.pool.get(block=False)
                try:
                    del connection
                except:
                    pass
            except queue.Empty:
                break
