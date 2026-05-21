# Safety Officer Log

This is a Vite + React + TypeScript PWA for field safety logging.

## Local Development

```bash
npm install
npm run dev
```

## Build (Production)

```bash
npm run build
```

Build output is generated in `dist/`.

## Easiest Remote Testing (No Same WiFi)

Use this when sharing with a single external tester.

1. Start production preview server:

```bash
npm run build
npm run preview:public
```

2. In a second terminal, open a public tunnel:

```bash
npm run share
```

3. Copy the HTTPS URL shown by localtunnel and send it to your tester.

The tester can open it from any network (mobile data, home WiFi, office internet).

## Important Testing Notes

- Keep both terminal windows running while the tester is validating.
- If camera access is tested, it works best over HTTPS (tunnel URL provides HTTPS).
- This app uses a service worker cache. If updates are not visible, do a hard refresh or clear site data.

## Alternative: Static Hosted Link (Most Stable)

If you want a link that stays up without your laptop running:

1. Run `npm run build`
2. Upload the `dist/` folder to a static host (for example Netlify Drop)
3. Share the hosted HTTPS link
