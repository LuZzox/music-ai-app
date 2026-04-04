# ---------------------------------------------------------
# main.py – CrewAI (>=1.0) + Ollama via LangChain
# ---------------------------------------------------------

import os
from dotenv import load_dotenv

# CrewAI (les agents, les tâches, le crew)
from crewai import Agent, Task, Crew
from crewai import LLM

llm = LLM(
    model="ollama/llama3",
    base_url="http://localhost:11434"
)

# ---------------------------------------------------------
# 1️⃣  Charger le fichier .env (optionnel)
# ---------------------------------------------------------
load_dotenv()   # vous pouvez y mettre OLLAMA_HOST si vous avez changé le port
# ---------------------------------------------------------
# 3️⃣  Définir les agents (tous utilisent le même LLM)
# ---------------------------------------------------------
architect = Agent(
    role="Software Architect",
    goal="Design the music app",
    backstory="Expert in Python and web apps",
    llm=llm,          # ← crucial
    verbose=True
)

backend_dev = Agent(
    role="Backend Developer",
    goal="Créer un backend Node.js avec Express et SQLite",
    backstory="Expert Node.js",
    llm=llm,
    verbose=True
)

qa = Agent(
    role="QA Engineer",
    goal="Corriger les bugs et améliorer le code",
    backstory="Expert debugging",
    llm=llm,
    verbose=True
)

# ---------------------------------------------------------
# 4️⃣  MVP description (ce que doit faire l’app)
# ---------------------------------------------------------
mvp = """
Je veux une app qui :
- lit des fichiers MP3
- possède une queue
- passe au morceau suivant automatiquement
- stocke les musiques dans SQLite
"""

# ---------------------------------------------------------
# 5️⃣  Tâches à réaliser
# ---------------------------------------------------------
task1 = Task(
    description=f"Analyse ce MVP et découpe‑le en tâches techniques détaillées:\n{mvp}",
    expected_output="Liste claire de tâches (en français) avec ordre logique",
    agent=architect
)

task2 = Task(
    description="Créer un backend Node.js avec Express et SQLite",
    expected_output="Code complet du backend (index.js, package.json, scripts SQLite, README)",
    agent=backend_dev
)

task3 = Task(
    description="Analyse le code backend, trouve les bugs et améliore la qualité",
    expected_output="Code corrigé, documentation mise à jour, tests simples",
    agent=qa
)

# ---------------------------------------------------------
# 6️⃣  Crew – orchestration de toutes les tâches
# ---------------------------------------------------------
crew = Crew(
    agents=[architect, backend_dev, qa],
    tasks=[task1, task2, task3],
    verbose=True,          # affichage détaillé du déroulement
    process="sequential"  # exécution dans l’ordre des tâches
)

# ---------------------------------------------------------
# 7️⃣  Lancement du workflow
# ---------------------------------------------------------
if __name__ == "__main__":
    crew.kickoff()
