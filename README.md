# 🚜 The Farmer Was Replaced — Clone 3D

Clone web do jogo **The Farmer Was Replaced**, feito em **JavaScript puro + Three.js**.
Você não controla o drone — você **programa** ele.

## ▶ Rodar

Abra `index.html` em qualquer navegador moderno (precisa de servidor local por causa de módulos ES e texturas):

```powershell
# opção 1 — Live Server do VS Code
# opção 2 — python
python -m http.server 8000
```

Acesse `http://localhost:8000`.

## 📂 Estrutura

```
.
├── index.html              # entrada da aplicação (HTML + UI + menus)
├── src/
│   ├── game.js             # lógica do jogo (cena, drones, culturas, executor)
│   └── style.css           # estilos (jogo + menus)
├── assets/
│   ├── textures/
│   │   ├── grass/          # Poliigon GrassPatchyGround (PBR)
│   │   └── metal/          # Poliigon MetalSteelBrushed (PBR)
│   └── models/
│       ├── hat/            # Chapéu (FBX) do drone
│       ├── tree/           # Lowpoly tree (FBX/OBJ)
│       ├── extra-tree/     # Tree.fbx alternativa
│       └── silo/           # Modelo do Silo (OBJ + textura)
├── docs/                   # documentação extra
├── .gitignore
└── README.md
```

## 🎮 Como Jogar

- Escreva código no editor (sintaxe estilo Python/JS) e clique **▶ Executar**.
- Comandos básicos: `move()`, `turn_left()`, `turn_right()`, `till()`, `plant()`, `harvest()`.
- Compre o **Drone B** para automação:
  - `auto_b()` — colhe e planta sozinho
  - `auto_b_madeira()` — corta árvores sozinho
- Venda colheitas no silo para upgrades.
- **ESC** abre o menu de pausa.

## 🌱 Culturas Disponíveis

| Cultura | Ícone | Desbloqueio |
|---|---|---|
| Milho | 🌽 | Início |
| Soja | 🌱 | Cedo |
| Trigo | 🌾 | 75 |
| Batata | 🥔 | 100 |
| Tomate | 🍅 | 130 |
| Cenoura | 🥕 | 165 |
| Abóbora | 🎃 | 210 |
| Cana | 🎋 | 270 |
| Uva | 🍇 | 350 |

## 🛠 Stack

- **three.js** (r0.164) — renderização 3D
- **sql.js** — persistência (SQLite no navegador)
- **JS vanilla** — sem build, sem framework

## 📝 Licença

Projeto pessoal/educativo.
