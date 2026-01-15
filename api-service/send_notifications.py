import json
import os
import sqlite3
import time
from datetime import datetime, timedelta
from typing import Dict, List

import clickhouse_driver
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Expo push notification service endpoint
EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send"

# Database connections
DB_PATH = os.getenv(
    "DATABASE_URL",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "bluesky_trends.sqlite"),
)

# ClickHouse configuration
CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "localhost")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "9000"))
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_DATABASE = os.getenv("CLICKHOUSE_DATABASE", "default")

# Initialize ClickHouse client
clickhouse_client = clickhouse_driver.Client(
    host=CLICKHOUSE_HOST,
    port=CLICKHOUSE_PORT,
    user=CLICKHOUSE_USER,
    password=CLICKHOUSE_PASSWORD,
    database=CLICKHOUSE_DATABASE,
)


# Connect to SQLite database
def get_db_connection():
    # Make sure the directory exists before connecting
    db_dir = os.path.dirname(DB_PATH)
    if not os.path.exists(db_dir) and db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# Get users with their notification preferences and device tokens
def get_users_for_notifications():
    conn = get_db_connection()
    users = conn.execute(
        """
        SELECT 
            did, 
            handle, 
            display_name, 
            followed_topics, 
            device_tokens, 
            last_notification_time 
        FROM users 
        WHERE device_tokens IS NOT NULL AND device_tokens != ''
        """
    ).fetchall()
    conn.close()
    return [dict(user) for user in users]


# Get recent trends from ClickHouse
def get_recent_trends(hours=3):
    current_time = int(time.time())
    time_ago = current_time - (hours * 3600)

    query = """
    SELECT
        keyword,
        post_count,
        summary,
        detected_at,
        post_ids
    FROM trends
    WHERE detected_at > %(time_ago)s
    ORDER BY post_count DESC
    LIMIT 30
    """

    results = clickhouse_client.execute(
        query, {"time_ago": time_ago}, with_column_types=True
    )
    rows, columns = results

    trends = []
    for row in rows:
        keyword, post_count, summary, detected_at, post_ids = row
        trends.append(
            {
                "keyword": keyword,
                "post_count": post_count,
                "summary": summary,
                "detected_at": datetime.fromtimestamp(detected_at).isoformat(),
                "post_ids": post_ids,
            }
        )

    return trends


# Format notification payload for Expo push service
def format_notification_payload(user: Dict, trends: List):
    # Get user's preferred topics
    user_topics = user["followed_topics"].split(",") if user["followed_topics"] else []

    # Filter trends based on user's preferences and topic associations
    matching_trends = []
    for trend in trends:
        # If user has no preferences, send all trends
        # Otherwise, check if trend matches any of user's topics
        keyword = trend["keyword"].lower()

        # Check for direct keyword matches first
        direct_match = not user_topics or any(
            topic.lower() in keyword for topic in user_topics
        )

        # Check topic associations if available
        topic_match = False
        if not direct_match and "topics" in trend:
            # Check if any of the trend's associated topics are in the user's followed topics
            topic_match = any(topic in user_topics for topic in trend.get("topics", []))

        if direct_match or topic_match:
            matching_trends.append(trend)

    # Limit to top 3 matching trends
    top_trends = matching_trends[:3]

    if not top_trends:
        return None

    # Create notification content
    if len(top_trends) == 1:
        title = f"Trending: {top_trends[0]['keyword']}"
        body = (
            top_trends[0]["summary"]
            or f"This topic is trending with {top_trends[0]['post_count']} posts"
        )
        data = {
            "type": "trend",
            "keyword": top_trends[0]["keyword"],
            "postCount": top_trends[0]["post_count"],
            "summary": top_trends[0]["summary"],
        }
    else:
        trend_names = [t["keyword"] for t in top_trends]
        title = "Trending Topics"
        body = f"{', '.join(trend_names[:2])} and more are trending"
        data = {
            "type": "trend",
            "trends": [
                {
                    "keyword": t["keyword"],
                    "postCount": t["post_count"],
                    "summary": t["summary"],
                }
                for t in top_trends
            ],
        }

    # Extract device tokens
    device_tokens = user["device_tokens"].split(",")

    # Format Expo push notification messages
    messages = []
    for token in device_tokens:
        if token.strip():
            messages.append(
                {
                    "to": token.strip(),
                    "title": title,
                    "body": body,
                    "data": data,
                    "sound": "default",
                    "badge": 1,
                    "channelId": "trends",
                }
            )

    return messages


# Send notifications using Expo Push API
def send_push_notifications(notifications):
    if not notifications:
        return {"success": [], "failure": []}

    # Expo push API has a limit of 100 notifications per request
    # Split into chunks if needed
    chunk_size = 100
    notification_chunks = [
        notifications[i : i + chunk_size]
        for i in range(0, len(notifications), chunk_size)
    ]

    success_tokens = []
    failure_tokens = []

    for chunk in notification_chunks:
        try:
            response = requests.post(
                EXPO_PUSH_API,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                json=chunk,
            )

            if response.status_code == 200:
                result = response.json()

                # Check each notification result
                for item in result.get("data", []):
                    if item.get("status") == "ok":
                        success_tokens.append(item.get("id"))
                    else:
                        failure_tokens.append(
                            {
                                "token": item.get("id"),
                                "error": item.get("message", "Unknown error"),
                            }
                        )
            else:
                # Handle HTTP error
                print(
                    f"Error sending notifications: {response.status_code} - {response.text}"
                )
                for notification in chunk:
                    failure_tokens.append(
                        {
                            "token": notification.get("to"),
                            "error": f"HTTP {response.status_code}",
                        }
                    )

        except Exception as e:
            # Handle request exception
            print(f"Exception sending notifications: {str(e)}")
            for notification in chunk:
                failure_tokens.append(
                    {"token": notification.get("to"), "error": str(e)}
                )

    return {"success": success_tokens, "failure": failure_tokens}


# Update user's last notification time
def update_notification_time(user_did, timestamp):
    conn = get_db_connection()
    conn.execute(
        "UPDATE users SET last_notification_time = ? WHERE did = ?",
        (timestamp, user_did),
    )
    conn.commit()
    conn.close()


# Main notification processing function
def process_notifications():
    print(f"Starting notification processing at {datetime.now().isoformat()}")

    # Get users eligible for notifications
    users = get_users_for_notifications()
    if not users:
        print("No users with push tokens found")
        return

    print(f"Found {len(users)} users with push tokens")

    # Get recent trends
    trends = get_recent_trends(hours=6)
    if not trends:
        print("No recent trends found")
        return

    print(f"Found {len(trends)} recent trends")

    # Current time for throttling notifications
    current_time = int(time.time())
    notification_cooldown = 6 * 3600  # Don't send more than once every 6 hours

    # Process each user
    all_notifications = []
    updated_users = 0

    for user in users:
        # Check if we should send notifications (respect cooldown period)
        last_notification = user.get("last_notification_time", 0) or 0
        time_since_last = current_time - last_notification

        if time_since_last < notification_cooldown:
            print(f"Skipping user {user['handle']} - notification too recent")
            continue

        # Format notification payload for this user
        user_notifications = format_notification_payload(user, trends)

        if user_notifications:
            all_notifications.extend(user_notifications)

            # Update user's last notification time
            update_notification_time(user["did"], current_time)
            updated_users += 1

    # Send all notifications
    if all_notifications:
        print(f"Sending {len(all_notifications)} push notifications")
        result = send_push_notifications(all_notifications)
        print(
            f"Notification result: {len(result['success'])} succeeded, {len(result['failure'])} failed"
        )
    else:
        print("No notifications to send")

    print(f"Updated {updated_users} users' notification timestamps")
    print(f"Notification processing completed at {datetime.now().isoformat()}")


# Run the notification process
if __name__ == "__main__":
    process_notifications()
