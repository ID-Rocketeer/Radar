# Custom Agent Rules for Radar Project

## Answer Questions Without Changing Code
- **Rule**: When the user asks a question (e.g., asking how a feature works, why a behavior occurs, or what variables control a setting), treat it strictly as an informational request.
- **Action**: Answer the question directly and explain the underlying mechanics. Do **not** make any modifications to the codebase or submit plans to change code unless the user explicitly requests an implementation change. Keep the workspace clean.

## Documentation Integrity and Easter Egg Secrecy
- **Documentation Rule**: Keep user-facing documentation (specifically `README.md` and the in-app operations manual modal inside `index.html`) fully updated and synchronized with all feature implementations, performance constraints, and UI updates.
- **Easter Egg Secrecy Rule**: The "CodeRed" easter egg is a secret. Its activation sequence, deactivation mechanism (pilot light interactions), and operational behavior **must be completely omitted** from all user-facing documentation (including `README.md`, the operations manual, and any help menus). Do not leak them under any circumstances.

## Preferred Testing Location for Mock Targets
- **Rule**: When staging mock targets for testing or silhouette comparison, use the coordinates east of Shannon, NZ (Latitude: `-40.5472`, Longitude: `175.4107`, placing targets starting east at `175.48`).
- **Reason**: This provides a clear, low-traffic area with no map tags and minimal visual noise, ideal for side-by-side silhouette analysis.


