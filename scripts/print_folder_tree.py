#!/usr/bin/env python3
import os
import sys

# ============================================
# CONFIGURATION : Mettez simplement le chemin relatif ici
# ============================================
TARGET_PATH = r"src"
# Autres exemples :
# TARGET_PATH = r'src\sections'
# TARGET_PATH = r'src\app'
# ============================================

# Listes d'exclusion alignées sur print_specific_tree.py
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
    ".codex",
    ".roo",
    "SEO",
    "automation"

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
    'print_folder_tree.py',
}

# Calcule la racine du projet (parent du dossier scripts)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)


def get_filtered_entries(directory):
    """Retourne (sous-dossiers, fichiers) triés alphabétiquement après filtrage."""
    try:
        entries = sorted(os.listdir(directory))
    except (PermissionError, FileNotFoundError):
        return [], []

    dirs = []
    files = []
    for entry in entries:
        path = os.path.join(directory, entry)
        if os.path.isdir(path):
            if entry not in IGNORE_DIRS:
                dirs.append(entry)
        elif os.path.isfile(path):
            if entry not in IGNORE_FILES and not any(entry.endswith(ext) for ext in IGNORE_FILES_EXT):
                files.append(entry)

    return dirs, files


def print_minimal_tree(directory, prefix=""):
    """Affiche l'arborescence minimale: sous-dossiers + aperçu du 1er fichier.

    Pour chaque dossier, affiche le premier fichier (trié alphabétiquement)
    suivi de `[...]` si d'autres fichiers existent. Si le dossier ne contient
    qu'un seul fichier, seul celui-ci est affiché.
    """
    dirs, files = get_filtered_entries(directory)

    # Calcule le nombre d'items à afficher à ce niveau (sous-dossiers + aperçu)
    preview_count = 0
    if len(files) == 1:
        preview_count = 1
    elif len(files) >= 2:
        preview_count = 2  # 1er fichier + [...]

    total_items = len(dirs) + preview_count
    item_index = 0

    # Affiche les sous-dossiers (puis récursion)
    for dir_name in dirs:
        is_last = (item_index == total_items - 1)
        connector = "└── " if is_last else "├── "
        print(f"{prefix}{connector}{dir_name}")

        child_prefix = prefix + ("    " if is_last else "│   ")
        print_minimal_tree(os.path.join(directory, dir_name), child_prefix)
        item_index += 1

    # Aperçu fichier à la fin
    if len(files) == 1:
        is_last = (item_index == total_items - 1)
        connector = "└── " if is_last else "├── "
        print(f"{prefix}{connector}{files[0]}")
    elif len(files) >= 2:
        # 1er fichier (toujours suivi de [...])
        print(f"{prefix}├── {files[0]}")
        # [...] toujours dernier
        print(f"{prefix}└── [...]")


def build_parent_tree(path_parts):
    """Construit l'arborescence des dossiers parents."""
    lines = []
    for i, part in enumerate(path_parts):
        if i == 0:
            lines.append(f"{part}/")
        else:
            indent = "    " * i
            lines.append(f"{indent}└── {part}/")
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

    # Affiche le contenu du dossier cible (arborescence minimale)
    print_minimal_tree(absolute_path, indent)

    print(f"\n✅ Arborescence minimale de '{TARGET_PATH}' affichée avec succès.")


if __name__ == "__main__":
    main()
