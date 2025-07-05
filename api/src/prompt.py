import os
import json
from typing import Dict, List

class PromptTemplate:
    """Charge et rend une template .prompt exportée depuis Dataiku"""
    def __init__(self, file_path: str):
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        p = data["prompt"]
        self.system_template: str = p["textPromptSystemTemplate"]
        self.user_template: str = p["textPromptTemplate"]
        self.input_names: List[str] = [i["name"] for i in p["textPromptTemplateInputs"]]
        self.temperature: float = data.get("completionSettings", {}).get("temperature", 0)
        self.json_mode: bool = data.get("completionSettings", {}).get("responseFormat", {}).get("type") == "json_object"

    def render(self, **kwargs) -> Dict[str, str]:
        system = self.system_template
        user = self.user_template
        for k, v in kwargs.items():
            system = system.replace(f"{{{{{k}}}}}", str(v))
            user = user.replace(f"{{{{{k}}}}}", str(v))
        return {"system": system, "user": user}

def load_prompts_from_dir() -> Dict[str, PromptTemplate]:
    prompt_dir = os.path.join(os.path.dirname(__file__), "prompts")
    prompts = {}
    for fname in os.listdir(prompt_dir):
        if fname.endswith('.prompt'):
            key = fname.replace('.prompt', '')
            prompts[key] = PromptTemplate(os.path.join(prompt_dir, fname))
    return prompts

# Ajout d'alias lisibles/compatibilité legacy
def build_prompt_registry() -> Dict[str, PromptTemplate]:
    prompts = load_prompts_from_dir()

    alias_map = {
        "000": "compute_nc_scenarios_propose_000",
        "100": "compute_nc_scenarios_propose_100",
        "query": "compute_nc_scenarios_query",
        "nc_search": "compute_nc_scenarios_search_nc",
        "doc_search": "compute_nc_scenarios_search_techdocs",
    }

    for alias, target in alias_map.items():
        if target in prompts:
            prompts[alias] = prompts[target]

    return prompts 