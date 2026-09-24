#!/usr/bin/env python3
import os
import sys

# ============================================
# CONFIGURATION : Mettez simplement le chemin relatif ici
# ============================================
TARGET_PATH = r"src"
# Autres exemples :
# TARGET_PATH = 'opportunities_setting_prototype'
# TARGET_PATH = r'doc\architectures'
# TARGET_PATH = r'src\modules\analyses'
# ============================================

# Listes d'exclusion alignées sur print_tree.py
IGNORE_DIRS = {
    'node_modules',
    '.next',
    '.git',
    '.vscode',
    '.turbo',
    '.locofy',
    'dist',
    '.storybook',
    'build',
    '.github',
    'backend',
    'claude',
    'doc',
    'helper',
    'scripts',
    'storybook-static',
    'meta',
    'test-components',
    ".venv",
    "__pycache__",
}

IGNORE_FILES_EXT = {
    '.log',
    '.lock',
    '.zip',

}

IGNORE_FILES = {
    'package-lock.json',
    'yarn.lock',
    '.env.local',
    'detect_unused.py',
    'print_tree.py',
    'print_specific_tree.py',
}

# Calcule la racine du projet (parent du dossier scripts)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)


def print_tree(directory, prefix=""):
    """Affiche récursivement l'arborescence d'un dossier en excluant certains dossiers/fichiers."""
    try:
        entries = sorted(os.listdir(directory))
    except PermissionError:
        print(f"{prefix}[Permission denied]")
        return
    except FileNotFoundError:
        print(f"{prefix}[Directory not found]")
        return

    # Filtre les dossiers et fichiers selon les règles d'exclusion
    filtered_entries = []
    for entry in entries:
        path = os.path.join(directory, entry)

        # Exclure les dossiers ignorés
        if os.path.isdir(path) and entry in IGNORE_DIRS:
            continue

        # Exclure les fichiers par nom ou extension
        if os.path.isfile(path):
            if entry in IGNORE_FILES:
                continue
            if any(entry.endswith(ext) for ext in IGNORE_FILES_EXT):
                continue

        filtered_entries.append(entry)

    entries_count = len(filtered_entries)

    for index, entry in enumerate(filtered_entries):
        path = os.path.join(directory, entry)
        connector = "└── " if index == entries_count - 1 else "├── "
        print(f"{prefix}{connector}{entry}")
        if os.path.isdir(path):
            extension_prefix = "    " if index == entries_count - 1 else "│   "
            print_tree(path, prefix + extension_prefix)


def build_parent_tree(path_parts):
    """Construit l'arborescence des dossiers parents."""
    lines = []
    for i, part in enumerate(path_parts):
        if i == 0:
            lines.append(f"{part}/")
        else:
            indent = "    " * i
            connector = "└── " if i == len(path_parts) - 1 else "└── "
            lines.append(f"{indent}{connector}{part}/")
    return lines


def main():
    # Normalise le chemin (convertit les / en \ sur Windows et vice versa)
    normalized_path = os.path.normpath(TARGET_PATH)

    # Construit le chemin absolu par rapport à la racine du projet
    absolute_path = os.path.join(PROJECT_ROOT, normalized_path)

    # Vérifie que le chemin existe
    if not os.path.exists(absolute_path):
        print(f"❌ Erreur : Le chemin '{TARGET_PATH}' n'existe pas.")
        print(f"   Chemin absolu testé : {absolute_path}")
        sys.exit(1)

    # Vérifie que c'est un dossier
    if not os.path.isdir(absolute_path):
        print(f"❌ Erreur : Le chemin '{TARGET_PATH}' n'est pas un dossier.")
        sys.exit(1)

    # Sépare le chemin en parties
    path_parts = normalized_path.split(os.sep)

    # Affiche l'arborescence des parents
    parent_lines = build_parent_tree(path_parts)
    for line in parent_lines:
        print(line)

    # Calcule l'indentation pour le contenu
    indent = "    " * len(path_parts)

    # Affiche le contenu du dossier cible
    print_tree(absolute_path, indent)

    print(f"\n✅ Arborescence de '{TARGET_PATH}' affichée avec succès.")


if __name__ == "__main__":
    main()
