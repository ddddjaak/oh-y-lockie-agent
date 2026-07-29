# Accessibility Checklist

Quick reference for ensuring embedded systems are accessible to users with diverse needs. Use alongside product design specifications.

> **Note:** This checklist focuses on embedded device accessibility — physical controls, indicators, audio feedback, and console/serial interfaces. For web application accessibility (WCAG, ARIA, HTML patterns), see dedicated web accessibility resources.

## Physical Controls

- [ ] Buttons have tactile feedback (click, detent, or vibration)
- [ ] Minimum button size: 10mm diameter for finger activation
- [ ] Buttons spaced at least 3mm apart (edge to edge)
- [ ] Critical controls distinguishable by shape/size (not just color)
- [ ] Force required to activate is within accessible range (1-5N for finger press)
- [ ] Controls reachable with one hand for handheld devices

## Visual Indicators

- [ ] LED indicators flash at 1-3 Hz for attention (not faster — can trigger photosensitive issues)
- [ ] Status communicated through multiple channels: LED + audio + haptic where possible
- [ ] Color is not the sole indicator of state (use pattern, position, or audio as redundant cue)
- [ ] Display text: minimum contrast ratio 4.5:1 for small text, 3:1 for large text
- [ ] Display brightness adjustable or auto-adjusting for ambient light

## Audio Feedback

- [ ] Audio alerts accompany visual alerts for critical states (errors, completion)
- [ ] Volume adjustable or configurable (not fixed at maximum)
- [ ] Audio patterns: rising tone = success, falling tone = error, repeating = attention

## Serial / Console Interface

- [ ] CLI help available via `help` or `?` command
- [ ] Error messages use plain language, not raw error codes alone
- [ ] Configuration commands support `get` and `set` patterns (discoverable)
- [ ] Baud rate and framing documented in user-facing materials

## Documentation

- [ ] Quick start guide uses pictures/diagrams alongside text
- [ ] LED patterns documented with timing (e.g., "3 rapid blinks = error, 1 slow blink = normal")
- [ ] Physical interface diagram labels all controls and indicators
- [ ] Error recovery procedures documented (what to do when LED blinks red)

## Verification

- [ ] All critical states have at least two feedback modalities (visual + audio, or visual + haptic)
- [ ] Buttons tested with gloved hands if device intended for outdoor/industrial use
- [ ] Display readable in direct sunlight if device intended for outdoor use
- [ ] Audio alerts audible in expected ambient noise environment
