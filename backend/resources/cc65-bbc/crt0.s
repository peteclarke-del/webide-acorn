; 8bit-net WebIDE Acorn cc65 BBC runtime startup
;
; A BBC Micro program is entered with CALL, so preserve the hardware stack
; pointer and cc65's $70-$8F zero-page workspace before calling C main().

        .export         _exit
        .export         __STARTUP__ : absolute = 1
        .import         callmain, donelib, initlib, zerobss
        .import         __STACKSTART__
        .importzp       sp

        .segment        "STARTUP"

start:  cld
        tsx
        stx             spsave
        ldx             #$1F
savezp: lda             $70,x
        sta             zpsave,x
        dex
        bpl             savezp
        lda             #<__STACKSTART__
        ldx             #>__STACKSTART__
        sta             sp
        stx             sp+1
        jsr             zerobss
        jsr             initlib
        jsr             callmain

_exit:  sta             exitcode
        jsr             donelib
        ldx             #$1F
loadzp: lda             zpsave,x
        sta             $70,x
        dex
        bpl             loadzp
        ldx             spsave
        txs
        lda             exitcode
        ldx             #$00
        rts

        .segment        "ZPSAVE"
spsave: .res            1
exitcode:
        .res            1
zpsave: .res            $20
