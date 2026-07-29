# Embedded Performance Checklist

Quick reference for embedded firmware performance targets. Use alongside `performance-optimization`.

## Memory Budget

| Resource | Budget | Check |
|----------|--------|-------|
| Flash used | < 80% of available | `arm-none-eabi-size firmware.elf` |
| RAM used (.data + .bss) | < 80% of available | Map file analysis |
| Stack depth (worst case) | < 70% of total | GCC `-fstack-usage` + stack analyzer |
| Heap | Pool only, no general heap | Code review |
| ISR stack | Sized for worst-case nesting + 50% | Manual estimate |

## Real-Time Budget

| Metric | Budget | Check |
|--------|--------|-------|
| ISR max duration | < 50 µs (system-dependent) | GPIO toggle + scope |
| Critical section max | < 20 µs | Timer measurement |
| Task period jitter | < 10% of period | GPIO toggle at task start |
| Interrupt latency (worst case) | < 10 µs | GPIO toggle at ISR entry vs trigger |

## Power Budget

| Metric | Budget | Check |
|--------|--------|-------|
| Run current | Per datasheet | Power analyzer |
| Sleep current | Per datasheet + 10% margin | Power analyzer |
| Duty cycle | Target < 5% (battery) | Scope measurement |

## Code Size Checklist

- [ ] `-Os` or `-O2` for release builds
- [ ] `-ffunction-sections -fdata-sections` enabled
- [ ] `-Wl,--gc-sections` enabled
- [ ] `-flto` enabled (if compatible)
- [ ] Map file analyzed — top 20 symbols by size reviewed
- [ ] printf replaced with minimal formatter or stripped from release
- [ ] `-specs=nano.specs` for smaller C library
- [ ] Unused peripheral drivers excluded via Kconfig or conditional compile

## Analysis Commands

```bash
# Size
arm-none-eabi-size firmware.elf
arm-none-eabi-nm --size-sort firmware.elf | tail -20
python3 tools/size_check.py firmware.map 524288 65536

# Stack
arm-none-eabi-gcc -fstack-usage -c src/*.c
python3 tools/stack_analyzer.py build/

# Power profiling: connect PPK2/Otii/Joulescope
# Measure idle, active, and TX current in each operating mode
```

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|---|---|---|
| Busy-wait loops | 100% CPU utilization | Use interrupt-driven or RTOS-blocking |
| printf in release | Adds 10-15KB flash | Strip or replace |
| Large local arrays | Stack overflow | Static allocation or pool |
| malloc/free after boot | Fragmentation | Pool allocator |
| Uninitialized GPIOs | Floating pins draw current | Output-low or input with pull |
| -O0 for release | 2-5x larger/slower | Use -Os |
| No stack monitoring | Silent overflow | Watermark or MPU guard |
