---
name: device-tree
description: 设备树设计：DTS编写、设备树绑定（.yaml）、Kconfig集成、板级配置overlay、引脚控制（pinctrl）、Zephyr设备树API（DT_NODELABEL, DT_PATH, DT_PROP）、chosen节点、别名（aliases）。Device tree design — Devicetree specification (DTS) authoring, DTS bindings (.yaml), Kconfig integration, board configuration overlays, pin control (pinctrl), Zephyr devicetree API (DT_NODELABEL, DT_PATH, DT_PROP), chosen nodes, and aliases. Use when the user says device tree, 设备树, DTS, devicetree, overlay, pinctrl, or when designing Zephyr/Linux devicetree configurations for an embedded system.
---
# Device Tree Design

## Overview

The devicetree is the hardware description language of modern embedded systems. It replaces the old pattern of `#define UART0_BASE 0x40001000` with a structured, hierarchical description of every hardware component. When you write a devicetree, you are not just configuring the kernel — you are defining the contract between hardware and software that the build system, the driver framework, and the application all rely on.

This skill covers the complete devicetree workflow: authoring `.dts` and `.dtsi` files, writing YAML bindings for new devices, creating board-specific overlays, configuring pinctrl, and using the Zephyr devicetree API in C code. It focuses on the Zephyr RTOS devicetree conventions, which are the most widely used in the Cortex-M ecosystem.

## When to Use

- Creating a new board definition (`.dts`) for a custom PCB
- Adding support for a new peripheral to a board's devicetree
- Writing YAML bindings for a custom driver's devicetree node
- Creating overlay files (`.overlay`) for board variants or application-specific configurations
- Configuring pin control (pinctrl) for I2C, SPI, UART, and other peripherals
- Using chosen nodes and aliases to abstract hardware from application code
- Debugging devicetree build errors or runtime issues (missing nodes, wrong properties)

**When NOT to use:** Writing the driver implementation that consumes the devicetree (use `peripheral-driver-design`), selecting which MCU to use (use `hardware-architecture-design`), or Linux kernel-specific devicetree topics (this skill focuses on Zephyr RTOS conventions).

## DTS Syntax Primer

### The Hierarchy Model

The devicetree hierarchy in Zephyr follows a strict layering: Vendor SoC `.dtsi` defines what the chip has (all peripherals, usually `status = "disabled"`), Board `.dts` enables what the board uses (sets `status = "okay"`, assigns pins), and Application `.overlay` adds/overrides for a specific application build. Each layer adds to or overrides the previous — there is no "removal" except through explicit `/delete-node/` and `/delete-property/` directives in overlays.

Key concepts:
- **Node labels** (`&uart0`): references to nodes by their label
- **Node paths** (`/soc/uart@40002000`): absolute path references
- **Phandles** (`<&gpio0 13 0>`): references with data cells
- **Properties**: strings, integers, booleans, arrays, string arrays
- **Status values**: `"okay"` (operational), `"disabled"` (present but not used — default in .dtsi), `"reserved"` (not for OS use), `"fail"` (probe failed)

### Pin Control (Pinctrl)

Pinctrl is how you assign SoC pins to peripheral functions. Without it, UART TX might be on the wrong pin. Defined in a board's `-pinctrl.dtsi` file:

```dts
&pinctrl {
    uart0_default: uart0_default {
        group1 {
            psels = <NRF_PSEL(UART_TX, 0, 6)>,   // P0.06 = TXD
                    <NRF_PSEL(UART_RX, 0, 8)>;   // P0.08 = RXD
        };
    };
    uart0_sleep: uart0_sleep {
        group1 {
            psels = <NRF_PSEL(UART_TX, 0, 6)>,
                    <NRF_PSEL(UART_RX, 0, 8)>;
            low-power-enable;
        };
    };
    i2c0_default: i2c0_default {
        group1 {
            psels = <NRF_PSEL(TWIM_SDA, 0, 26)>,
                    <NRF_PSEL(TWIM_SCL, 0, 27)>;
        };
    };
    spi1_default: spi1_default {
        group1 {
            psels = <NRF_PSEL(SPIM_SCK, 0, 31)>,
                    <NRF_PSEL(SPIM_MOSI, 0, 30)>,
                    <NRF_PSEL(SPIM_MISO, 0, 29)>;
        };
    };
};

// Usage in peripheral node:
&uart0 {
    pinctrl-0 = <&uart0_default>;   // Active state pin config
    pinctrl-1 = <&uart0_sleep>;     // Sleep state pin config
    pinctrl-names = "default", "sleep";
};
```

Pinctrl gotchas: One pin, one function. Two peripherals claiming the same pin causes conflicts. Sleep state must configure pins for minimum leakage (input, no pull) — floating inputs in sleep waste uA-mA. Always cross-reference your board schematic.

## YAML Binding Authoring

### Binding Structure

```yaml
# dts/bindings/sensor/mycompany,mysensor.yaml
description: MyCompany MYSENSOR temperature and humidity sensor
compatible: "mycompany,mysensor"
include: [sensor-device.yaml, i2c-device.yaml]

properties:
  reg:
    required: true
    description: I2C address of the sensor
  
  sample-rate-hz:
    type: int
    default: 10
    description: Sampling rate in Hz. Valid: 1, 10, 25, 50.
  
  temperature-resolution:
    type: int
    default: 12
    enum: [9, 10, 11, 12]
    description: ADC resolution in bits for temperature measurement
  
  vdd-supply:
    type: phandle
    description: Regulator controlling power to this sensor
  
  drdy-gpios:
    type: phandle-array
    description: Data-ready interrupt pin. Optional — driver uses polling if absent.
```

### Common Binding Patterns

```yaml
# GPIO:          irq-gpios:       { type: phandle-array }
# PWM:           pwms:            { type: phandle-array, required: true }
# ADC/DAC:       io-channels:     { type: phandle-array, required: true }
# SPI clock:     spi-max-frequency: { type: int, default: 1000000 }
# Card detect:   cd-gpios:        { type: phandle-array }
# Write protect: wp-gpios:        { type: phandle-array }
```

## Zephyr Devicetree API in C Code

### The Macro System

Zephyr provides macros for accessing devicetree data at compile time — no runtime parsing:

```c
#include <zephyr/devicetree.h>

// Step 1: Get a node identifier
#define MY_SENSOR_NODE DT_NODELABEL(bme280)
// Or: DT_PATH(soc, spi_40003000, bme280_0) or DT_ALIAS(env_sensor)

// Step 2: Compile-time conditional
#if DT_NODE_HAS_STATUS(MY_SENSOR_NODE, okay)
    // Sensor is enabled — include its driver
#endif

// Step 3: Read properties
#define BME280_I2C_ADDR  DT_PROP(MY_SENSOR_NODE, reg)
#define BME280_BUS_DEV   DT_BUS(MY_SENSOR_NODE)
```

### Common Macro Reference

| Category | Macro | Purpose |
|----------|-------|---------|
| **Node Access** | `DT_NODELABEL(label)` | Get node by label |
| | `DT_ALIAS(alias_name)` | Get node by alias |
| | `DT_PATH(...)` | Get node by absolute path |
| | `DT_PARENT(node)` / `DT_CHILD(node, child)` | Navigate hierarchy |
| **Properties** | `DT_PROP(node, prop)` | Get property value |
| | `DT_PROP_LEN(node, prop)` | Get array property length |
| | `DT_NODE_HAS_PROP(node, prop)` | Check property existence |
| **Status** | `DT_NODE_HAS_STATUS(node, status)` | Check status (okay, disabled) |
| | `DT_NODE_EXISTS(node)` | Check if node exists |
| **Bus** | `DT_BUS(node)` | Get bus node for I2C/SPI device |
| **GPIO** | `GPIO_DT_SPEC_GET(node, prop)` | Get gpio_dt_spec from property |
| **Chosen** | `DT_CHOSEN(zephyr_console)` | Get console UART node |
| **Instance** | `DT_INST_FOREACH_STATUS_OKAY(macro)` | Iterate all enabled instances |

### Driver Integration Pattern

```c
// How a driver consumes its devicetree configuration:
#include <zephyr/device.h>
#include <zephyr/devicetree.h>

#define MY_SENSOR_INST(n)                                                    \
    static const struct my_sensor_config my_sensor_config_##n = {            \
        .i2c_addr    = DT_INST_PROP(n, reg),                                 \
        .sample_rate = DT_INST_PROP(n, sample_rate_hz),                      \
        .temp_res    = DT_INST_PROP(n, temperature_resolution),              \
        COND_CODE_1(DT_INST_NODE_HAS_PROP(n, drdy_gpios),                    \
            (.drdy = GPIO_DT_SPEC_INST_GET(n, drdy_gpios),),                 \
            (.drdy = {0},)                                                   \
        ),                                                                   \
        .bus = DEVICE_DT_GET(DT_INST_BUS(n)),                                \
    };

// Instantiate for each enabled instance
DT_INST_FOREACH_STATUS_OKAY(MY_SENSOR_INST)
```

## Board Overlay Creation

### When to Use Overlays vs Board Files

Use Board `.dts` for permanent hardware changes (pin assignments, permanent sensors, power rails). Use Application `.overlay` for app-specific changes (enabling optional sensors, debug UART, specific SPI mode). Use board `.dts` base + variant `.overlay` for multiple board variants with minor differences. Use `.overlay` for testing a new peripheral before committing to the board file.

### Overlay Examples

```dts
/ {
    custom_config {
        compatible = "mycompany,custom-config";
        firmware-version-major = <1>;
        firmware-version-minor = <3>;
        enable-feature-x;
    };
};

// Enable a disabled peripheral
&spi2 {
    status = "okay";
    cs-gpios = <&gpio1 10 GPIO_ACTIVE_LOW>;
    external_flash: mx25r64@0 {
        compatible = "jedec,spi-nor";
        reg = <0>;
        spi-max-frequency = <80000000>;
        size = <67108864>;
        has-dpd;
        t-enter-dpd = <3000>;
        t-exit-dpd = <3000>;
        jedec-id = [c2 28 17];
    };
};

// Override property: &uart0 { current-speed = <921600>; hw-flow-control; };
// Remove node: /delete-node/ &unused_i2c_sensor;
```

## Debugging Devicetree Issues

| Error | Cause | Fix |
|-------|-------|-----|
| `undefined node label 'X'` | Node label doesn't exist or `.dtsi` include missing | Add missing include or use correct label |
| `undefined reference to __device_dts_ord_XX` | Device referenced in code but not enabled in DT | Set `status = "okay"` on the node |
| `DT_PROP(node, reg) has unexpected type` | Property not defined in node or its binding | Add property to node or fix binding |
| `pin conflict: P0.06 used by UART0 and I2C0` | Two peripherals claim same pin | Check schematic, reassign one |
| DT node present but `.dts` generated code doesn't use it | Binding file missing or incompatible | Check `compatible` string, create binding |
| GPIO interrupt not firing | Pin configured wrong in pinctrl | Verify `psels` entries match schematic |

### Devicetree Inspection Commands

```bash
# Dump the final merged devicetree (after all overlays applied)
west build -t devicetree

# Dump memory regions from devicetree
west build -t ram_report
west build -t rom_report

# List all nodes with their status
west build -t devicetree | grep -E "^\s+\S+@\S+"

# Verify a specific node exists
west build -t devicetree | grep -A 20 "my_device@"
```

## Kconfig Integration

```kconfig
# Devicetree and Kconfig work together. Devicetree describes hardware;
# Kconfig enables/disables software features.

# Kconfig can reference devicetree using HAS_DTS_ macros:
config HAS_MY_SENSOR
    bool
    default y if $(dt_compat_enabled,mycompany,mysensor)

config MY_SENSOR_SAMPLE_RATE
    int "Default sample rate"
    default $(dt_prop_int,mycompany,mysensor,sample-rate-hz) if HAS_MY_SENSOR
    default 10
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll just use `#define` for hardware addresses" | `#define` hardcodes hardware for one board. Devicetree makes the same driver work across boards without code changes. A year from now, when you port to a new board, you'll thank the devicetree. |
| "The binding is optional, the driver works without it" | The binding validates your devicetree at build time. Without it, a typo in a property name goes undetected until runtime — at which point your sensor silently uses the wrong I2C address. |
| "I'll just put everything in the board `.dts`" | Board `.dts` defines the board. Application `.overlay` defines what THIS application uses from the board. Mixing them makes it impossible to build multiple applications for the same board without conflicts. |
| "Pinctrl is complicated, I'll set pins in the driver init" | Then your driver has board-specific pin knowledge, which defeats the purpose of a portable driver. Pinctrl goes in the devicetree where it belongs. |
| "I don't need aliases, I'll reference nodes by label" | Labels work within the devicetree. Aliases provide a stable, documented API for application code. `DT_ALIAS(led0)` tells you it's the primary LED; `DT_NODELABEL(led_0)` tells you nothing about its role. |
| "Devicetree is overkill for a simple MCU project" | Even a simple board has pin assignments and peripheral addresses. Devicetree documents them in one place — the board file — instead of scattering them across driver init functions. |

## Red Flags

- `#define` for peripheral base addresses in application code (use devicetree macros)
- Pin assignments hardcoded in driver init instead of using pinctrl
- No YAML binding for custom devices (build can't validate properties)
- Application `.overlay` replicating what's already in the board `.dts`
- Node labels used where aliases should be (aliases document intent)
- `status = "okay"` on peripherals not actually used by the application (wastes power)
- Pinctrl sleep state omitted (pins stay configured in sleep = power drain)
- Custom `chosen` nodes without documenting their contract (what property, what type, required/optional)
- Devicetree changes without updating the corresponding YAML binding
- `DT_PROP()` used without `DT_NODE_HAS_STATUS(node, okay)` guard (build breaks if device disabled)

## Verification

After designing the devicetree:

- [ ] The board `.dts` compiles without warnings (run `west build` on the board target)
- [ ] The final merged devicetree dump shows all expected nodes with `status = "okay"`
- [ ] YAML bindings exist for all custom devices (check `dts/bindings/` directory)
- [ ] Pinctrl configurations match the board schematic (verify every pin number)
- [ ] Pinctrl sleep state configured for minimum power (no pull-ups driving low, no floating inputs)
- [ ] Aliases defined for all externally-referenced nodes (leds, buttons, sensors, storage)
- [ ] `chosen` nodes set for console, storage partitions, and any application-specific devices
- [ ] Application `.overlay` does not duplicate board `.dts` content
- [ ] Build works with the targeted peripheral disabled (`status = "disabled"`) — no undefined references
- [ ] Negative test: misspell a property name, confirm YAML binding catches it at build time
- [ ] Negative test: assign a pin to two peripherals, confirm pinctrl conflict is detected
- [ ] Negative test: reference a disabled node in code, confirm compile error with clear message

## After This Skill

Once devicetree configuration is complete:

| Next Step | Skill | What It Produces |
|-----------|-------|-----------------|
| Driver implementation | `peripheral-driver-design` | Driver that reads config from DT macros |
| Board bring-up | `board-bringup` | First boot with devicetree-defined peripherals |
| Hardware architecture | `hardware-architecture-design` | Pin assignments feeding into pinctrl |
| Build system setup | `embedded-build-and-toolchain` | Integration of `.dts`, `.overlay`, and Kconfig into build |
