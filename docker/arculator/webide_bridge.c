#include <stdint.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif
#include "arc.h"
#include "disc.h"
#include "ioc.h"
#include "mem.h"
#include "memc.h"
#include "plat_sound.h"
#include "vidc.h"

#define WEBIDE_BREAKPOINTS 64
#define WEBIDE_BREAKPOINT_CONDITIONS 4
#define WEBIDE_LOG_EVENTS 64
extern int memsize;
extern int soundena;
extern int mode;
extern uint32_t opcode2, opcode3;
extern uint32_t userregs[16], superregs[16], fiqregs[16], irqregs[16];
extern uint8_t *mempoint[16384];
extern uint8_t memstat[16384];
extern uint32_t *ram;
extern uint32_t *rom;
extern uint8_t *rom_arcrom;
extern uint8_t *rom_5th_column;
int arc_webide_injected_key[512];
int arc_webide_injected_mouse_active;
int arc_webide_injected_mouse_x;
int arc_webide_injected_mouse_y;
int arc_webide_injected_mouse_buttons;
extern void refillpipeline2(void);
extern void updatemode(int mode);
extern int arc_webide_is_paused(void);
static int32_t webide_breakpoints[WEBIDE_BREAKPOINTS];
static uint32_t webide_breakpoint_hits[WEBIDE_BREAKPOINTS];
static uint32_t webide_breakpoint_targets[WEBIDE_BREAKPOINTS];
static uint8_t webide_breakpoint_condition_counts[WEBIDE_BREAKPOINTS];
static int8_t webide_breakpoint_registers[WEBIDE_BREAKPOINTS][WEBIDE_BREAKPOINT_CONDITIONS];
static uint8_t webide_breakpoint_operators[WEBIDE_BREAKPOINTS][WEBIDE_BREAKPOINT_CONDITIONS];
static uint32_t webide_breakpoint_values[WEBIDE_BREAKPOINTS][WEBIDE_BREAKPOINT_CONDITIONS];
static uint8_t webide_breakpoint_actions[WEBIDE_BREAKPOINTS];
static uint32_t webide_log_sequences[WEBIDE_LOG_EVENTS];
static uint32_t webide_log_addresses[WEBIDE_LOG_EVENTS];
static uint32_t webide_log_hits[WEBIDE_LOG_EVENTS];
static uint32_t webide_log_registers[WEBIDE_LOG_EVENTS][16];
static uint32_t webide_log_sequence;
static uint32_t webide_log_count;
static uint32_t webide_log_write;
static uint32_t webide_log_dropped;
static int webide_breakpoints_initialized;
static int32_t webide_break_hit = -1;
static int32_t webide_skip_breakpoint = -1;
static uint32_t webide_hook_count;
static uint32_t webide_last_hook_pc;
static int32_t webide_watch_address = -1;
static int32_t webide_watch_hit = -1;
int arc_webide_breakpoints_active;

static void initialize_breakpoints(void)
{
    int index;
    if (webide_breakpoints_initialized) return;
    for (index = 0; index < WEBIDE_BREAKPOINTS; index++) {
        webide_breakpoints[index] = -1; webide_breakpoint_targets[index] = 1;
        webide_breakpoint_condition_counts[index] = 0;
    }
    webide_breakpoints_initialized = 1;
}

static void record_logpoint(int slot, uint32_t pc)
{
    int index; uint32_t destination = webide_log_write;
    webide_log_sequence++;
    webide_log_sequences[destination] = webide_log_sequence;
    webide_log_addresses[destination] = pc;
    webide_log_hits[destination] = webide_breakpoint_hits[slot];
    for (index = 0; index < 15; index++) webide_log_registers[destination][index] = armregs[index];
    webide_log_registers[destination][15] = pc;
    webide_log_write = (webide_log_write + 1) % WEBIDE_LOG_EVENTS;
    if (webide_log_count < WEBIDE_LOG_EVENTS) webide_log_count++;
    else webide_log_dropped++;
}

int arc_webide_breakpoint_at(uint32_t pc)
{
    int index;
    initialize_breakpoints();
    pc &= 0x3fffffc;
    webide_hook_count++;
    webide_last_hook_pc = pc;
    if (webide_watch_address == (int32_t)pc) {
        webide_watch_hit = webide_watch_address;
        webide_watch_address = -1;
        if (arc_webide_breakpoints_active > 0) arc_webide_breakpoints_active--;
    }
    if (webide_skip_breakpoint == (int32_t)pc) { webide_skip_breakpoint = -1; return 0; }
    for (index = 0; index < WEBIDE_BREAKPOINTS; index++)
        if (webide_breakpoints[index] == (int32_t)pc) {
            uint32_t actual, expected; int condition_index, matched = 1;
            webide_breakpoint_hits[index]++;
            if (webide_breakpoint_hits[index] < webide_breakpoint_targets[index]) continue;
            for (condition_index = 0; condition_index < webide_breakpoint_condition_counts[index]; condition_index++) {
                actual = webide_breakpoint_registers[index][condition_index] == 15 ? pc : armregs[(int)webide_breakpoint_registers[index][condition_index]];
                expected = webide_breakpoint_values[index][condition_index];
                switch (webide_breakpoint_operators[index][condition_index]) {
                    case 1: matched = actual == expected; break;
                    case 2: matched = actual != expected; break;
                    case 3: matched = actual < expected; break;
                    case 4: matched = actual <= expected; break;
                    case 5: matched = actual > expected; break;
                    case 6: matched = actual >= expected; break;
                    default: matched = 0;
                }
                if (!matched) break;
            }
            if (!matched) continue;
            if (webide_breakpoint_actions[index] != 0) record_logpoint(index, pc);
            if (webide_breakpoint_actions[index] != 1) { webide_break_hit = (int32_t)pc; return 1; }
        }
    return 0;
}

int arc_webide_break_pending(void) { return webide_break_hit >= 0; }
void arc_webide_skip_current_breakpoint(void) { webide_skip_breakpoint = webide_break_hit; webide_break_hit = -1; }

int EMSCRIPTEN_KEEPALIVE arc_webide_set_breakpoint(int slot, uint32_t address)
{
    initialize_breakpoints();
    if (slot < 0 || slot >= WEBIDE_BREAKPOINTS || (address & 3)) return 0;
    if (webide_breakpoints[slot] < 0) arc_webide_breakpoints_active++;
    webide_breakpoints[slot] = (int32_t)(address & 0x3fffffc);
    webide_breakpoint_hits[slot] = 0; webide_breakpoint_targets[slot] = 1;
    webide_breakpoint_condition_counts[slot] = 0;
    webide_breakpoint_actions[slot] = 0; return 1;
}

int EMSCRIPTEN_KEEPALIVE arc_webide_configure_breakpoint(int slot, uint32_t hit_target, int condition_register, int condition_operator, uint32_t condition_value, int action)
{
    initialize_breakpoints();
    if (slot < 0 || slot >= WEBIDE_BREAKPOINTS || webide_breakpoints[slot] < 0 || hit_target < 1 || hit_target > 1000000) return 0;
    if (condition_register < -1 || condition_register > 15 || (condition_register >= 0 && (condition_operator < 1 || condition_operator > 6))) return 0;
    if (action < 0 || action > 2) return 0;
    webide_breakpoint_targets[slot] = hit_target; webide_breakpoint_condition_counts[slot] = condition_register < 0 ? 0 : 1;
    if (condition_register >= 0) {
        webide_breakpoint_registers[slot][0] = (int8_t)condition_register;
        webide_breakpoint_operators[slot][0] = (uint8_t)condition_operator;
        webide_breakpoint_values[slot][0] = condition_value;
    }
    webide_breakpoint_actions[slot] = (uint8_t)action;
    return 1;
}

int EMSCRIPTEN_KEEPALIVE arc_webide_set_breakpoint_condition(int slot, int condition_index, int condition_register, int condition_operator, uint32_t condition_value)
{
    initialize_breakpoints();
    if (slot < 0 || slot >= WEBIDE_BREAKPOINTS || webide_breakpoints[slot] < 0) return 0;
    if (condition_index < 0 || condition_index >= WEBIDE_BREAKPOINT_CONDITIONS || condition_index != webide_breakpoint_condition_counts[slot]) return 0;
    if (condition_register < 0 || condition_register > 15 || condition_operator < 1 || condition_operator > 6) return 0;
    webide_breakpoint_registers[slot][condition_index] = (int8_t)condition_register;
    webide_breakpoint_operators[slot][condition_index] = (uint8_t)condition_operator;
    webide_breakpoint_values[slot][condition_index] = condition_value;
    webide_breakpoint_condition_counts[slot]++;
    return 1;
}

void EMSCRIPTEN_KEEPALIVE arc_webide_clear_breakpoints(void)
{
    int index; initialize_breakpoints();
    for (index = 0; index < WEBIDE_BREAKPOINTS; index++) { webide_breakpoints[index] = -1; webide_breakpoint_hits[index] = 0; }
    arc_webide_breakpoints_active = webide_watch_address >= 0 ? 1 : 0;
    webide_break_hit = webide_skip_breakpoint = -1;
}

int EMSCRIPTEN_KEEPALIVE arc_webide_breakpoint_hit(void) { return webide_break_hit; }
int EMSCRIPTEN_KEEPALIVE arc_webide_get_breakpoint(int slot) { initialize_breakpoints(); return (slot >= 0 && slot < WEBIDE_BREAKPOINTS) ? webide_breakpoints[slot] : -1; }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_get_breakpoint_hits(int slot) { initialize_breakpoints(); return (slot >= 0 && slot < WEBIDE_BREAKPOINTS) ? webide_breakpoint_hits[slot] : 0; }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_log_event_count(void) { return webide_log_count; }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_log_event_dropped(void) { return webide_log_dropped; }
static int webide_log_event_index(int index)
{
    uint32_t oldest;
    if (index < 0 || (uint32_t)index >= webide_log_count) return -1;
    oldest = webide_log_count < WEBIDE_LOG_EVENTS ? 0 : webide_log_write;
    return (int)((oldest + (uint32_t)index) % WEBIDE_LOG_EVENTS);
}
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_log_event_value(int index, int field)
{
    int source = webide_log_event_index(index);
    if (source < 0) return 0;
    if (field == 0) return webide_log_sequences[source];
    if (field == 1) return webide_log_addresses[source];
    if (field == 2) return webide_log_hits[source];
    return (field >= 3 && field < 19) ? webide_log_registers[source][field - 3] : 0;
}
void EMSCRIPTEN_KEEPALIVE arc_webide_clear_log_events(void)
{
    webide_log_count = webide_log_write = webide_log_dropped = 0;
}
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_hook_count(void) { return webide_hook_count; }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_last_hook_pc(void) { return webide_last_hook_pc; }
int EMSCRIPTEN_KEEPALIVE arc_webide_watch_execution(uint32_t address)
{
    if (address > 0x3ffffff || (address & 3)) return 0;
    if (webide_watch_address < 0) arc_webide_breakpoints_active++;
    webide_watch_address = (int32_t)(address & 0x3fffffc);
    webide_watch_hit = -1;
    return 1;
}
int EMSCRIPTEN_KEEPALIVE arc_webide_execution_watch_hit(void) { return webide_watch_hit; }
void EMSCRIPTEN_KEEPALIVE arc_webide_clear_execution_watch(void)
{
    if (webide_watch_address >= 0 && arc_webide_breakpoints_active > 0) arc_webide_breakpoints_active--;
    webide_watch_address = webide_watch_hit = -1;
}
int EMSCRIPTEN_KEEPALIVE arc_webide_set_host_key(int scancode, int pressed)
{
    if (scancode < 0 || scancode >= 512) return 0;
    arc_webide_injected_key[scancode] = pressed ? 1 : 0;
    return 1;
}
void EMSCRIPTEN_KEEPALIVE arc_webide_clear_host_keys(void)
{
    int scancode;
    for (scancode = 0; scancode < 512; scancode++) arc_webide_injected_key[scancode] = 0;
}
int EMSCRIPTEN_KEEPALIVE arc_webide_set_host_mouse(int x, int y, int buttons)
{
    if (x < 0 || x > 32767 || y < 0 || y > 32767 || buttons < 0 || buttons > 7) return 0;
    arc_webide_injected_mouse_x = x;
    arc_webide_injected_mouse_y = y;
    arc_webide_injected_mouse_buttons = buttons;
    arc_webide_injected_mouse_active = 1;
    return 1;
}
void EMSCRIPTEN_KEEPALIVE arc_webide_clear_host_mouse(void)
{
    arc_webide_injected_mouse_active = 0;
    arc_webide_injected_mouse_buttons = 0;
}
int EMSCRIPTEN_KEEPALIVE arc_webide_get_host_mouse(int field)
{
    if (field == 0) return arc_webide_injected_mouse_active;
    if (field == 1) return arc_webide_injected_mouse_x;
    if (field == 2) return arc_webide_injected_mouse_y;
    return field == 3 ? arc_webide_injected_mouse_buttons : -1;
}
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_get_memory_kib(void) { return (uint32_t)memsize; }
int EMSCRIPTEN_KEEPALIVE arc_webide_audio_available(void) { return sound_dev_available(); }
int EMSCRIPTEN_KEEPALIVE arc_webide_audio_enabled(void) { return soundena ? 1 : 0; }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_audio_queued_bytes(void) { return sound_dev_queued_bytes(); }
int EMSCRIPTEN_KEEPALIVE arc_webide_audio_capture_start(uint32_t seconds) { return sound_capture_start(seconds); }
void EMSCRIPTEN_KEEPALIVE arc_webide_audio_capture_stop(void) { sound_capture_stop(); }
void EMSCRIPTEN_KEEPALIVE arc_webide_audio_capture_release(void) { sound_capture_release(); }
int EMSCRIPTEN_KEEPALIVE arc_webide_audio_capture_active(void) { return sound_capture_active(); }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_audio_capture_frames(void) { return sound_capture_frames(); }
uintptr_t EMSCRIPTEN_KEEPALIVE arc_webide_audio_capture_data(void) { return (uintptr_t)sound_capture_data(); }
int EMSCRIPTEN_KEEPALIVE arc_webide_disc_loaded(int drive) { return (drive >= 0 && drive < 4 && !disc_empty(drive)) ? 1 : 0; }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_get_register(int index) { return (index >= 0 && index < 16) ? armregs[index] : 0; }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_get_pc(void) { return (PC - 8) & 0x3fffffc; }
int EMSCRIPTEN_KEEPALIVE arc_webide_set_register(int index, uint32_t value)
{
    if (!arc_webide_is_paused() || index < 0 || index > 15) return 0;
    if (index < 15) { armregs[index] = value; return armregs[index] == value; }
    if (value > 0x3fffffc || (value & 3)) return 0;
    armregs[15] = (armregs[15] & 0xfc000003) | ((value + 8) & 0x03fffffc);
    refillpipeline2();
    return (((PC - 8) & 0x3fffffc) == value) ? 1 : 0;
}
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_get_mode(void) { return (uint32_t)(mode & 3); }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_get_pipeline_word(int stage)
{
    if (stage == 0) return opcode2;
    if (stage == 1) return opcode3;
    return stage == 2 ? readmemf_debug(PC & 0x3fffffc) : 0;
}
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_get_banked_register(int requested_mode, int index)
{
    if (requested_mode < 0 || requested_mode > 3 || index < 8 || index > 14) return 0;
    if (requested_mode == mode) return armregs[index];
    if (requested_mode == 1) return fiqregs[index];
    if (index < 13) return mode == 1 ? userregs[index] : armregs[index];
    if (requested_mode == 2) return irqregs[index - 13];
    if (requested_mode == 3) return superregs[index - 13];
    return userregs[index];
}
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_inspect_hardware(int group, int index)
{
    if (group == 0) {
        switch (index) {
            case 0: return (uint32_t)vidc_displayon;
            case 1: return (uint32_t)vidc_framecount;
            case 2: return (uint32_t)vidc_dma_length;
            case 3: return (uint32_t)vidc_getclock();
            case 4: return vidc_get_current_vaddr();
            case 5: return vidc_get_current_caddr();
            case 6: return (uint32_t)vidc_cursor_visible();
            default: return 0;
        }
    }
    if (group == 1) {
        switch (index) {
            case 0: return (uint32_t)memc_videodma_enable;
            case 1: return (uint32_t)memc_refreshon;
            case 2: return (uint32_t)memc_is_memc1;
            case 3: return (uint32_t)memc_type;
            case 4: return sstart;
            case 5: return ssend;
            case 6: return sptr;
            case 7: return spos;
            case 8: return sendN;
            case 9: return sstart2;
            case 10: return (uint32_t)sdmaena;
            case 11: return (uint32_t)memc_dma_sound_req;
            case 12: return (uint32_t)memc_dma_video_req;
            case 13: return (uint32_t)memc_dma_cursor_req;
            default: return 0;
        }
    }
    if (group == 2) {
        if (index == 0) return ioc.irqa;
        if (index == 1) return ioc.irqb;
        if (index == 2) return ioc.fiq;
        if (index == 3) return ioc.mska;
        if (index == 4) return ioc.mskb;
        if (index == 5) return ioc.mskf;
        if (index == 6) return ioc.ctrl;
        if (index >= 7 && index < 11) return (uint32_t)ioc.timerc[index - 7];
        if (index >= 11 && index < 15) return (uint32_t)ioc.timerl[index - 11];
        return 0;
    }
    if (group == 3) {
        if (index >= 0 && index < 64) return vidc_webide_register(index);
        if (index >= 64 && index < 84) return vidc_webide_runtime(index - 64);
        return 0;
    }
    if (group == 4) {
        if (index == 0) return (uint32_t)curdrive;
        if (index == 1) return (uint32_t)disc_drivesel;
        if (index == 2) return (uint32_t)motoron;
        if (index == 3) return (uint32_t)fdc_ready;
        if (index == 4) return (uint32_t)fdc_overridden;
        if (index >= 5 && index < 9) return (uint32_t)!disc_empty(index - 5);
        if (index >= 9 && index < 13) return (uint32_t)disc_get_current_track(index - 9);
        if (index >= 13 && index < 17) return (uint32_t)writeprot[index - 13];
        return 0;
    }
    if (group == 5) {
        if (index == 0) return (uint32_t)sound_dev_available();
        if (index == 1) return (uint32_t)(soundena ? 1 : 0);
        if (index == 2) return sound_dev_queued_bytes();
        return 0;
    }
    return 0;
}
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_read_word(uint32_t address) { return readmemf_debug(address); }
uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_read_byte(uint32_t address)
{
    uint32_t aligned = readmemf_debug(address & ~3u);
    return (aligned >> ((address & 3u) * 8u)) & 0xffu;
}

uint32_t EMSCRIPTEN_KEEPALIVE arc_webide_memory_page(int page, int field)
{
    uintptr_t mapped, start, end;
    uint32_t logical;
    if (page < 0 || page >= 16384 || field < 0 || field > 1 || !mempoint[page]) return field == 0 ? 0 : 0xffffffffu;
    logical = (uint32_t)page << 12;
    mapped = (uintptr_t)&mempoint[page][logical];
    start = (uintptr_t)ram; end = start + ((uint32_t)memsize * 1024u);
    if (mapped >= start && mapped < end) return field == 0 ? 1 : (uint32_t)((mapped - start) >> 12);
    start = (uintptr_t)rom; end = start + 0x200000u;
    if (mapped >= start && mapped < end) return field == 0 ? 2 : (uint32_t)((mapped - start) >> 12);
    start = (uintptr_t)rom_arcrom; end = start + 0x10000u;
    if (mapped >= start && mapped < end) return field == 0 ? 3 : (uint32_t)((mapped - start) >> 12);
    start = (uintptr_t)rom_5th_column; end = start + 0x20000u;
    if (mapped >= start && mapped < end) return field == 0 ? 4 : (uint32_t)((mapped - start) >> 12);
    return field == 0 ? 5 : 0xffffffffu;
}

int EMSCRIPTEN_KEEPALIVE arc_webide_write_memory(uint32_t address, const uint8_t *bytes, uint32_t length)
{
    uint8_t original[256]; uint8_t *ram_start = (uint8_t *)ram;
    uint8_t *ram_end = ram_start + ((uint32_t)memsize * 1024u);
    uint32_t offset;
    if (!arc_webide_is_paused() || !bytes || length < 1 || length > 256 || address > 0x3ffffff || address + length < address || address + length > 0x4000000) return 0;
    for (offset = 0; offset < length; offset++) {
        uint32_t current = address + offset; uint8_t *page = mempoint[current >> 12]; uint8_t *destination;
        if (!page) return 0;
        destination = &page[current];
        if (destination < ram_start || destination >= ram_end) return 0;
        original[offset] = *destination;
    }
    for (offset = 0; offset < length; offset++) writememfb_debug(address + offset, bytes[offset]);
    for (offset = 0; offset < length; offset++) if (arc_webide_read_byte(address + offset) != bytes[offset]) {
        uint32_t rollback; for (rollback = 0; rollback < length; rollback++) writememfb_debug(address + rollback, original[rollback]);
        return 0;
    }
    return 1;
}

int EMSCRIPTEN_KEEPALIVE arc_webide_load_program(uint32_t address, const uint8_t *bytes, uint32_t length, uint32_t entry, int install_debug_mapping)
{
    uint32_t offset;
    uint32_t end;
    if (!arc_webide_is_paused() || !bytes || !length || address < 0x8000 || address > 0xfffff || length > 0xf8000) return 0;
    end = address + length;
    if (end < address || end > 0x100000 || entry < address || entry >= end || (entry & 3)) return 0;
    if (install_debug_mapping) {
        if (end > (uint32_t)memsize * 1024u) return 0;
        for (offset = address >> 12; offset <= (end - 1) >> 12; offset++) {
            mempoint[offset] = (uint8_t *)ram;
            memstat[offset] = 3;
        }
    }
    for (offset = address >> 12; offset <= (end - 1) >> 12; offset++) if (!mempoint[offset]) return 0;
    for (offset = 0; offset < length; offset++) writememfb_debug(address + offset, bytes[offset]);
    for (offset = 0; offset < length; offset++) {
        uint32_t word = readmemf_debug((address + offset) & ~3u);
        if (((word >> (((address + offset) & 3u) * 8u)) & 0xffu) != bytes[offset]) return 0;
    }
    if ((armregs[15] & 3) != 3) updatemode(3);
    /* The raw-debug ABI enters supervisor mode with both interrupt classes
     * masked. Otherwise an IOC interrupt pending at the asynchronous build
     * completion instant can vector back into RISC OS before the first source
     * instruction or its breakpoint is observed. */
    armregs[15] = (armregs[15] & 0xf0000000) | 0x0c000003 | ((entry + 8) & 0x03fffffc);
    refillpipeline2();
    return 1;
}
