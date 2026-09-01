/*
 * What the IDE is allowed to ask the Electron, and nothing else.
 *
 * Elkulator is a program with a window and a menu bar. The IDE is not: it owns
 * the surface, decides when the machine steps, and needs to read the machine's
 * state at instruction boundaries. This file is the whole of that interface, so
 * that everything the workbench can do to this core is visible in one place and
 * anything it cannot do is absent rather than half-answered.
 *
 * Two things are exposed here that ElkJS could not offer at all, and they are
 * the reason this core exists alongside it: a per-instruction hook, and memory
 * and registers that can be read and written between instructions. Elkulator
 * calls dodebugger() before every instruction it executes, so a hook in the
 * same place costs nothing when it is not armed and is exact when it is.
 *
 * Reading memory has two meanings and both are offered by name, because
 * conflating them would make the debugger lie. elk_webide_read_memory goes
 * through readmem, which is what the processor sees: paged ROM, the ULA and the
 * keyboard matrix answer, and a read can have a side effect. elk_webide_read_ram
 * reads the 32 KB RAM array directly, which is what a memory inspector wants,
 * and cannot disturb anything.
 */
#include <stdint.h>
#include <string.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif
#include "6502.h"
#include "mem.h"
#include "keyboard.h"

#define WEBIDE_BREAKPOINTS 32

/* The machine's own state, reached rather than copied. */
extern uint8_t ram[SIZE_32K];
extern bool elk_key_state[ELK_KEY_MAX];
extern int resetit;

/* Set by the hook and read by the loop: see elk_webide_before_instruction. */
int elk_webide_halted;
int elk_webide_hook_armed;

static int32_t webide_breakpoints[WEBIDE_BREAKPOINTS];
static uint32_t webide_breakpoint_hits[WEBIDE_BREAKPOINTS];
static int webide_breakpoints_initialized;
static int32_t webide_break_hit = -1;
static int32_t webide_step_remaining = -1;
static uint32_t webide_instructions;
static uint32_t webide_frames;
static int webide_breakpoints_armed;
static int webide_counting;

/*
 * The hook is armed only while something needs it, because it is a call before
 * every instruction the machine executes and the machine executes two million a
 * second. Three things need it, and each says so separately so that turning one
 * off cannot silently turn another off with it.
 */
static void update_hook(void)
{
    elk_webide_hook_armed = (webide_breakpoints_armed || webide_counting || webide_step_remaining >= 0) ? 1 : 0;
}

static void initialize(void)
{
    int index;
    if (webide_breakpoints_initialized) return;
    for (index = 0; index < WEBIDE_BREAKPOINTS; index++) webide_breakpoints[index] = -1;
    webide_breakpoints_initialized = 1;
}

/*
 * Called immediately before each instruction executes, from the same place
 * Elkulator calls its own debugger.
 *
 * Returning non-zero means "do not execute this one": the caller breaks out and
 * the machine is left standing exactly on this instruction, which is what makes
 * a step a step and a breakpoint stop before rather than after.
 */
int elk_webide_before_instruction(uint16_t at)
{
    int index;
    initialize();
    if (webide_step_remaining == 0)
    {
        webide_step_remaining = -1;
        elk_webide_halted = 1;
        update_hook();
        return 1;
    }
    for (index = 0; index < WEBIDE_BREAKPOINTS; index++)
    {
        if (webide_breakpoints[index] != (int32_t)at) continue;
        webide_breakpoint_hits[index]++;
        /* A breakpoint on the instruction the machine is already standing on
         * would stop it again immediately and it would never move. Stepping off
         * it is the caller's business, so a step in progress passes through. */
        if (webide_step_remaining > 0) break;
        webide_break_hit = index;
        elk_webide_halted = 1;
        return 1;
    }
    if (webide_step_remaining > 0) webide_step_remaining--;
    webide_instructions++;
    return 0;
}

/* Counted where the ULA completes a field, so it measures the machine's frames
 * rather than the browser's. */
void elk_webide_frame_completed(void) { webide_frames++; }

/* ---- Running -------------------------------------------------------------- */

int EMSCRIPTEN_KEEPALIVE elk_webide_paused(void) { return elk_webide_halted ? 1 : 0; }

void EMSCRIPTEN_KEEPALIVE elk_webide_pause(void)
{
    elk_webide_halted = 1;
    webide_step_remaining = -1;
    update_hook();
}

void EMSCRIPTEN_KEEPALIVE elk_webide_resume(void)
{
    elk_webide_halted = 0;
    webide_break_hit = -1;
    webide_step_remaining = -1;
    update_hook();
}

/* Run exactly `count` instructions and stop before the next one. */
int EMSCRIPTEN_KEEPALIVE elk_webide_step(int count)
{
    if (count < 1 || count > 1000000) return 0;
    webide_step_remaining = count;
    webide_break_hit = -1;
    elk_webide_halted = 0;
    /* Without this the machine simply resumes and never stops, which is what a
     * step did before the browser was asked what it had actually done. */
    update_hook();
    return 1;
}

/*
 * Counting instructions is asked for rather than assumed.
 *
 * The count comes from the hook, so it is only meaningful while the hook runs,
 * and arming the hook for every machine that is merely running would make every
 * machine pay for a debugger nobody opened. elk_webide_counting says whether
 * the number means anything, so a caller can report "not counted" instead of
 * reporting zero as though the machine had executed nothing.
 */
int EMSCRIPTEN_KEEPALIVE elk_webide_set_counting(int on)
{
    webide_counting = on ? 1 : 0;
    if (!webide_counting) webide_instructions = 0;
    update_hook();
    return webide_counting;
}

int EMSCRIPTEN_KEEPALIVE elk_webide_counting(void) { return elk_webide_hook_armed ? 1 : 0; }

int EMSCRIPTEN_KEEPALIVE elk_webide_breakpoint_hit(void) { return webide_break_hit; }
uint32_t EMSCRIPTEN_KEEPALIVE elk_webide_instructions(void) { return webide_instructions; }
uint32_t EMSCRIPTEN_KEEPALIVE elk_webide_frames(void) { return webide_frames; }

void EMSCRIPTEN_KEEPALIVE elk_webide_reset(void)
{
    /* The same reset the machine performs for itself, taken on the next field
     * rather than in the middle of an instruction. */
    resetit = 1;
    webide_break_hit = -1;
}

/* ---- Breakpoints ---------------------------------------------------------- */

int EMSCRIPTEN_KEEPALIVE elk_webide_set_breakpoint(int slot, uint32_t address)
{
    initialize();
    if (slot < 0 || slot >= WEBIDE_BREAKPOINTS || address > 0xffff) return 0;
    webide_breakpoints[slot] = (int32_t)address;
    webide_breakpoint_hits[slot] = 0;
    webide_breakpoints_armed = 1;
    update_hook();
    return 1;
}

int EMSCRIPTEN_KEEPALIVE elk_webide_get_breakpoint(int slot)
{
    initialize();
    return (slot >= 0 && slot < WEBIDE_BREAKPOINTS) ? webide_breakpoints[slot] : -1;
}

uint32_t EMSCRIPTEN_KEEPALIVE elk_webide_breakpoint_hits(int slot)
{
    initialize();
    return (slot >= 0 && slot < WEBIDE_BREAKPOINTS) ? webide_breakpoint_hits[slot] : 0;
}

void EMSCRIPTEN_KEEPALIVE elk_webide_clear_breakpoints(void)
{
    int index;
    initialize();
    for (index = 0; index < WEBIDE_BREAKPOINTS; index++)
    {
        webide_breakpoints[index] = -1;
        webide_breakpoint_hits[index] = 0;
    }
    webide_break_hit = -1;
    webide_breakpoints_armed = 0;
    update_hook();
}

/* ---- Registers ------------------------------------------------------------ */

/* Index order is the one the workbench debugger uses for a 6502. */
#define WEBIDE_REG_A  0
#define WEBIDE_REG_X  1
#define WEBIDE_REG_Y  2
#define WEBIDE_REG_S  3
#define WEBIDE_REG_P  4
#define WEBIDE_REG_PC 5

static uint8_t flags_byte(void)
{
    uint8_t value = 0x20;
    if (p.c) value |= 0x01;
    if (p.z) value |= 0x02;
    if (p.i) value |= 0x04;
    if (p.d) value |= 0x08;
    if (p.v) value |= 0x40;
    if (p.n) value |= 0x80;
    return value;
}

uint32_t EMSCRIPTEN_KEEPALIVE elk_webide_get_register(int index)
{
    switch (index)
    {
        case WEBIDE_REG_A:  return a;
        case WEBIDE_REG_X:  return x;
        case WEBIDE_REG_Y:  return y;
        case WEBIDE_REG_S:  return s;
        case WEBIDE_REG_P:  return flags_byte();
        case WEBIDE_REG_PC: return pc;
        default: return 0;
    }
}

int EMSCRIPTEN_KEEPALIVE elk_webide_set_register(int index, uint32_t value)
{
    switch (index)
    {
        case WEBIDE_REG_A:  a = (uint8_t)value; return 1;
        case WEBIDE_REG_X:  x = (uint8_t)value; return 1;
        case WEBIDE_REG_Y:  y = (uint8_t)value; return 1;
        case WEBIDE_REG_S:  s = (uint8_t)value; return 1;
        case WEBIDE_REG_P:
            p.c = (value & 0x01) ? 1 : 0; p.z = (value & 0x02) ? 1 : 0;
            p.i = (value & 0x04) ? 1 : 0; p.d = (value & 0x08) ? 1 : 0;
            p.v = (value & 0x40) ? 1 : 0; p.n = (value & 0x80) ? 1 : 0;
            return 1;
        case WEBIDE_REG_PC: pc = (uint16_t)value; return 1;
        default: return 0;
    }
}

/* ---- Memory --------------------------------------------------------------- */

/* What the processor sees, side effects and all. */
int EMSCRIPTEN_KEEPALIVE elk_webide_read_memory(uint32_t address)
{
    if (address > 0xffff) return -1;
    return readmem((uint16_t)address);
}

int EMSCRIPTEN_KEEPALIVE elk_webide_write_memory(uint32_t address, uint32_t value)
{
    if (address > 0xffff) return 0;
    writemem((uint16_t)address, (uint8_t)value);
    return 1;
}

/* The RAM array itself, which an inspector can read without disturbing the
 * machine. Above 0x7fff there is no RAM, and saying so is better than
 * returning the ROM byte that readmem would have given. */
int EMSCRIPTEN_KEEPALIVE elk_webide_read_ram(uint32_t address)
{
    if (address >= SIZE_32K) return -1;
    return ram[address];
}

/* Place a program in RAM. Returns the number of bytes written, which is zero
 * when the range would run past the end of RAM rather than a truncated write
 * nobody asked for. */
int EMSCRIPTEN_KEEPALIVE elk_webide_load(uint32_t address, uintptr_t source, uint32_t length)
{
    if (length == 0 || address >= SIZE_32K) return 0;
    if (address + length > SIZE_32K) return 0;
    memcpy(&ram[address], (const void *)source, length);
    return (int)length;
}

/* ---- Keyboard ------------------------------------------------------------- */

/* Electron keys, not host keys. The IDE knows which Electron key it means and
 * the host mapping in elk.cfg is a desktop concern that would only get in the
 * way here. */
int EMSCRIPTEN_KEEPALIVE elk_webide_set_key(int key, int pressed)
{
    if (key <= ELK_KEY_NONE || key >= ELK_KEY_MAX) return 0;
    elk_key_state[key] = pressed ? true : false;
    return 1;
}

void EMSCRIPTEN_KEEPALIVE elk_webide_clear_keys(void)
{
    int index;
    for (index = 0; index < ELK_KEY_MAX; index++) elk_key_state[index] = false;
}

int EMSCRIPTEN_KEEPALIVE elk_webide_key_count(void) { return ELK_KEY_MAX; }
