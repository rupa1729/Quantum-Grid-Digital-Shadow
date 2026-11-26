"""
Optional FastAPI microservice wrapper around qiskit_runner.py.
Run locally or deploy to a Python host and set QISKIT_SERVICE_URL in .env:
  pip install -r qiskit_service/requirements.txt
  uvicorn qiskit_service.app:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

from typing import Any, Dict
from fastapi import FastAPI, HTTPException

from .qiskit_runner import execute_qiskit_job, probe_environment

app = FastAPI(title="Digital Q-Grid Twin — Real IBM Qiskit Execution Service", version="1.0.0")


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, **probe_environment()}


@app.post("/execute")
def execute(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        result = execute_qiskit_job(payload)
        result["executionEngine"] = "qiskit_python_service"
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
