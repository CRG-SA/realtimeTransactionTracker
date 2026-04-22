#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>
#include <signal.h>

int
main (int argc, char **argv)
{
    int c = 0;
    signal (SIGTERM, SIG_IGN);
    while (1) {
        sleep (1);
        printf ("%d\n", ++c);
        if (c > 60)
            exit (1);
    }
    return 0;
}

