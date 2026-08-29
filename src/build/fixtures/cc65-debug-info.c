#include <stdint.h>
struct Point { int x; unsigned char y; };
typedef struct Point Point;
static unsigned char counter;
int total;
char *message;
int add(int a, unsigned char b) {
  int local = a + b;
  static int kept;
  kept += local;
  return kept;
}
void main(void) {
  Point p;
  p.x = add(total, counter);
  p.y = 1;
  message = 0;
}
