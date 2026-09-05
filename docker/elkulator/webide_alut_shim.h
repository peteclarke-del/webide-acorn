/* ALUT over raw OpenAL, because Emscripten ships the latter and not the former.
 *
 * Elkulator uses exactly two ALUT calls, and both are thin: alutInit opens the
 * default device and makes a context current, alutExit tears that down. Doing
 * it directly costs a dozen lines and removes a dependency that has no
 * Emscripten port at all.
 */
#ifndef WEBIDE_ALUT_SHIM_H
#define WEBIDE_ALUT_SHIM_H
#ifdef __EMSCRIPTEN__
#include <AL/al.h>
#include <AL/alc.h>

static ALCdevice *webide_alut_device = 0;
static ALCcontext *webide_alut_context = 0;

static inline void alutInit(int *argc, char **argv)
{
   (void)argc; (void)argv;
   webide_alut_device = alcOpenDevice(0);
   if (!webide_alut_device) return;
   webide_alut_context = alcCreateContext(webide_alut_device, 0);
   if (webide_alut_context) alcMakeContextCurrent(webide_alut_context);
}

static inline void alutExit(void)
{
   alcMakeContextCurrent(0);
   if (webide_alut_context) alcDestroyContext(webide_alut_context);
   if (webide_alut_device) alcCloseDevice(webide_alut_device);
   webide_alut_context = 0;
   webide_alut_device = 0;
}
#endif
#endif
