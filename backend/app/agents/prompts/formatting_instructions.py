"""
Agent formatting instructions for rich markdown and LaTeX support.

These instructions are injected into agent prompts to enable them to use
rich formatting in their responses, including:
- Markdown formatting (bold, italic, code blocks, lists, tables)
- LaTeX/math equations (inline and block)
- Workspace usage guidance (for software dev agents)
"""

# Shared markdown and math formatting instructions
MARKDOWN_FORMATTING = """
FORMATTING - You can use rich markdown in your responses:
- **Bold** and *italic* text for emphasis
- `inline code` and ```code blocks``` with syntax highlighting (specify language like ```python)
- Numbered lists (1. 2. 3.) and bullet points (- or *)
- > Blockquotes for important notes
- [Links](url) if relevant
- Tables using | pipes |

MATH EQUATIONS - For math, physics, or technical topics:
- Inline equations: $E = mc^2$ (single dollar signs)
- Block equations: $$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$ (double dollar signs)
- Use LaTeX syntax for equations - they will render beautifully!
- Examples: $\\frac{a}{b}$, $\\sqrt{x}$, $\\sum_{i=1}^n$, $\\alpha$, $\\beta$, $\\theta$

Use rich formatting when it helps clarity, especially for:
- Code examples (always use fenced code blocks with language)
- Mathematical expressions and equations
- Step-by-step instructions (numbered lists)
- Key terms or vocabulary (bold)
"""

# Instructions for coaching agents
COACHING_FORMATTING = MARKDOWN_FORMATTING

# Instructions for PM agents (software dev mode)
PM_FORMATTING = """
FORMATTING - You can use rich markdown in your responses:
- **Bold** and *italic* for emphasis
- `inline code` and ```fenced code blocks``` with syntax highlighting (specify language)
- Numbered and bullet lists for clarity
- > Blockquotes for important notes
- Tables using | pipes | when comparing options

MATH/EQUATIONS - When discussing algorithms, complexity, or technical concepts:
- Inline math: $O(n \\log n)$, $\\theta$, $\\sum_{i=1}^n$
- Block equations: $$T(n) = 2T(n/2) + O(n)$$
- Use LaTeX for formulas - they render beautifully in the UI!
"""

# Instructions for developer/QA agents (software dev mode)
DEV_FORMATTING = """
FORMATTING - You can use rich markdown in your responses:
- **Bold** and *italic* for emphasis
- `inline code` and ```fenced code blocks``` with syntax highlighting (specify language like ```python)
- Numbered and bullet lists for clear explanations
- > Blockquotes for important notes
- Tables using | pipes | when comparing options

MATH/EQUATIONS - When discussing algorithms, complexity, or technical concepts:
- Inline math: $O(n \\log n)$, $\\theta$, $\\sum_{i=1}^n$
- Block equations: $$T(n) = 2T(n/2) + O(n)$$
- Use LaTeX for formulas - they render beautifully in the UI!

YOUR PERSONAL WORKSPACE:
- You have access to the project workspace and can create files there
- You can use Claude Code to write actual code, run tests, and build features
- Feel free to use the workspace for experiments, prototypes, test files, documentation
- You can create LaTeX documents, diagrams (mermaid), test scripts, or any files to help your work
- The workspace is YOUR space to be productive - use it creatively!
"""
