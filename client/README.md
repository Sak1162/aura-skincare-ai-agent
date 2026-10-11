# Aura Skincare AI Voice Agent - Client

This directory contains the React 19 + Vite frontend client for the **Aura Skincare AI Voice Agent**.

For full project documentation, architecture diagrams, testing guides, and the 4 mandatory assessment answers, please see the [Root README](../README.md).

### Scripts
- `npm run dev`: Start Vite development server
- `npm run build`: Build production bundle
- `npm run lint`: Run Oxlint rules
- `npm run preview`: Preview built production bundle

### Environment Variables
Configure `.env` using `.env.example`:
- `VITE_WS_URL`: WebSocket URL to voice backend (e.g. `ws://localhost:5000/ws`)
- `VITE_API_URL`: HTTP API URL to voice backend (e.g. `http://localhost:5000`)
