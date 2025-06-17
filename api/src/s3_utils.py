import os
import boto3
from fastapi import HTTPException
from typing import List, Dict

S3_BUCKET_DOCS = os.getenv("S3_BUCKET_DOCS", "a220-tech-docs")
S3_BUCKET_NC = os.getenv("S3_BUCKET_NC", "a220-non-conformities")
S3_REGION = os.getenv("S3_REGION", "fr-par")
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", f"https://s3.{S3_REGION}.scw.cloud")
S3_API_ACCESS_KEY = os.getenv("S3_API_ACCESS_KEY")
S3_API_SECRET_KEY = os.getenv("S3_API_SECRET_KEY")

s3 = boto3.client(
    "s3",
    aws_access_key_id=S3_API_ACCESS_KEY,
    aws_secret_access_key=S3_API_SECRET_KEY,
    endpoint_url=S3_ENDPOINT_URL,
)

def fetch_s3_object(bucket: str, key: str) -> bytes:
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()
    except s3.exceptions.NoSuchKey:
        raise HTTPException(status_code=404, detail=f"File {key} not found in bucket {bucket}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def list_json_keys(bucket: str) -> List[str]:
    """Lists JSON keys from an S3 bucket.

    This function retrieves only the first page of results (up to 1000)
    for performance reasons. It does not paginate through the entire bucket.
    """
    response = s3.list_objects_v2(Bucket=bucket)
    keys = [
        item["Key"]
        for item in response.get("Contents", [])
        if item["Key"].endswith(".json")
    ]
    return keys 