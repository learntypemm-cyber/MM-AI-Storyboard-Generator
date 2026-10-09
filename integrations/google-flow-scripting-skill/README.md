# Bundled Google Flow Scripting Skill

This folder contains selected upstream files from [agbelemi/google-flow-scripting-skill](https://github.com/agbelemi/google-flow-scripting-skill), bundled under its MIT license. The upstream copyright notice is preserved in `LICENSE`.

## Included

- `SKILL.md`: the main instruction entry point.
- `core/`: orchestration, story architecture, asset management, storyboard direction, and continuity audit.
- `formats/`: live action, 2D/3D animation, ads, documentary, and music-video guidance.
- `reference/`: current Flow feature notes, failure modes, playbook, templates, and verification principles.
- `scripts/validate.py`: command-line validation for prompt files, timing, reference handles, model/mode constraints, prompt text policy, and storyboard contracts.
- `scripts/generate_storyboard_prompt.py`: builds a copy-ready visual storyboard contact-sheet prompt from a JSON specification.
- `examples/storyboard-spec.json`: sample input for the contact-sheet generator.

The React application in the parent repository is an independent implementation. This folder preserves the selected upstream skill materials so advanced users can run its tools and consult its specialist guidance locally.

## Validate a storyboard export

From the repository root, run:

```bash
python integrations/google-flow-scripting-skill/scripts/validate.py --help
```

For an 8-second Flow / Veo 3.1 Fast script:

```bash
python integrations/google-flow-scripting-skill/scripts/validate.py storyboard.md --segment-length 8 --surface flow --model veo-3.1-fast --mode text-to-video --beat-mode exact
```

The validator's findings are advisory production checks, not a guarantee of successful or consistent video generation. Always review scenes and verify supported options in the active Google Flow interface.

## Build a contact-sheet prompt

```bash
python integrations/google-flow-scripting-skill/scripts/generate_storyboard_prompt.py integrations/google-flow-scripting-skill/examples/storyboard-spec.json --output storyboard-package.md
```

See `SKILL.md`, `reference/PLAYBOOK.md`, and the relevant file in `core/` for the full operating workflow.
