; Minimal, documented BBC MOS console bridge for the WebIDE cc65 runtime.

        .export         _acorn_oswrch, _acorn_osrdch
        .export         _cputc, _putchar

        .segment        "CODE"

; void __fastcall__ acorn_oswrch(unsigned char value)
; int/char __fastcall__ putchar/cputc(value)
_acorn_oswrch:
_cputc:
_putchar:
        jsr             $FFEE           ; OSWRCH
        ldx             #$00
        rts

; unsigned char acorn_osrdch(void)
_acorn_osrdch:
        jsr             $FFE0           ; OSRDCH
        ldx             #$00
        rts
