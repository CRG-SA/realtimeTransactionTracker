/* spawn.c - program to start and monitor multiple instances
of a server. produces gdb backtraces on core dump in its log
files. */

/* Tue Dec 14 09:17:55 2004 - (PSR) sheerp@telkom.co.za */


#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <unistd.h>
#include <pwd.h>
#include <grp.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <time.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <assert.h>

#include "spawn.h"
#include "spawn_version.h"

#ifndef O_LARGEFILE
#define O_LARGEFILE 0
#endif

#define min(a,b)        ((a) < (b) ? (a) : (b))
#define max(a,b)        ((a) > (b) ? (a) : (b))
#define xfree(x)        do { if(x) free(x) ; (x) = NULL; } while (0)

enum life_state {
    LIFE_STATE_READY_TO_RESTART,
    LIFE_STATE_WAITING_FOR_SIGCHLD,
    LIFE_STATE_GOT_SIGCHLD,
    LIFE_STATE_WAITING_FOR_FD_CLOSE,
    LIFE_STATE_FD_CLOSED,
    LIFE_STATE_NEVER_RESTART
};

#define CHANGE_STATE(p,s)       do { (p)->life_state = s; if (option_verbose)           \
            log_fmt (logfile, 0, "%s:%d: %ld -> %s", __FILE__, __LINE__, (long) (p)->pid, #s); } while (0)

//HPUX:	#define GDB     "/opt/langtools/bin/gdb"
#define GDB     "/usr/bin/gdb"

static int option_instances = 1;
static int option_auto_restart = 0;
static int option_background = 0;
static int option_max_restarts_n = 5;
static int option_max_restarts_seconds = 5;
static int option_verbose = 0;
static long option_uid = -1;
static long option_gid = -1;
static char *option_log_file = NULL;
static char *option_pid_file = NULL;
static char *option_tempdir = "/tmp";
static char *option_std_output = NULL;
static char *option_mailing_list = NULL;

static time_t restart_window_begin;
static time_t death_start_time = 0;
static time_t kill_9_start_time = 0;
static int option_time_to_send_kill = 0;
static int n_restarts;
static int do_quit = 0;

static char hostname[512];


static FILE *logfile = NULL;

static void log_fmt (FILE * f, int err, const char *fmt, ...);
#define log_perror(x) log_fmt (logfile, errno, "%s", (x))


static void
usage_exit (int c)
{
    fprintf (stderr, "\n\
spawn [-help|--help]\n\
spawn [-instances <P>] [-kill <K>] [-user <user>] [-auto-restart] \\\n\
      [-background] [-max-restarts <N> <M>] [-log-file <logfile>] \\\n\
      [-std-output-file <std-logfile>] [-mail <file>] \\\n\
       --  <executable> <arg1> <arg2> ...\n\
     -help                              This help message.\n\
     -instances <P>                     The number of servers to run.\n\
     -tmp <DIR>                         Use a different tempory dir.\n\
                                        Default: /tmp\n\
     -kill <K>                          Number of seconds to wait until\n\
                                        sending SIGKILL. Default: off.\n\
     -user <uid>                        Run servers as user (name or uid).\n\
     -pid-file <pidfile>                Write the process ID to <pidfile>.\n\
     -auto-restart                      Restart servers on death.\n\
     -background                        Run in the background.\n\
     -max-restarts <N> <M>              Maximum restarts N within\n\
                                        time period M. Default: 5 5.\n\
     -log-file <logfile>                Write status (e.g. child death) info\n\
                                        to file <logfile>. Default: stdout.\n\
     -std-output-file <std-logfile>     Separate log file for stdout/stderr.\n\
     -mail <file>                       Send email with traceback on crash.\n\
                                        <file> contains a whitespace\n\
                                        separated list of address of the form\n\
                                        user@doma.in\n\
     -- <executable> <arg1> <arg2> ...  The server name and arguments.\n\
\n\
\n\
Spawn is a textbook unix system utility written in C to manage processes\n\
on the Unibase HP-UX live production system (although it entirely\n\
POSIX portable in the Zen tradition). Spawn is meant for properly\n\
managing a number of unreliable server processes to ensure that, at\n\
anyone time, a required minimum number of instances of that server is\n\
running, as well as to log and diagnose server crashes.\n\
\n\
Spawn starts <P> child processes of executable <executable>.\n\
The executable is envoked by its full path name after searching\n\
the PATH environment variable. The output (stderr and stdout)\n\
of all child processes is timestamped, multiplexed, and written to\n\
stderr (or <logfile>). Output newlines are properly interpreted\n\
(so as to prevent lines overlapping), line buffered, and prefixed\n\
by the server name and process id for easy inspection.\n\
\n\
The signals SIGTERM(%d), SIGINT(%d), and SIGQUIT(%d) are caught and\n\
passed on to the children. If any of these signals are recieved, no\n\
further restarting of children is attempted, and spawn will exit\n\
after the last child has died. Children that catch these signals\n\
and fail to timeously exit will be sent the SIGKILL(%d) after <K>\n\
seconds if the -kill option is specified. If these children still\n\
appear not to have died after 60 seconds, spawn prints \"X of N\n\
children still undead after T seconds, this is an OS bug, exitting\"\n\
and exits.\n\
\n\
Processes are started in their own unique directory /tmp/spawn* so\n\
that core files can be seperately examined. On death, the cause of\n\
death is logged and spawn attempts to envoke gdb on the core file\n\
with a gdb batch script that prints out a backtrace to the log file.\n\
After death, the /tmp/spawn* directory is cleaned and removed.\n\
\n\
Spawn expects gdb to be located in " GDB "\n\
\n\
If no children remain, and -auto-restart has not been specified,\n\
spawn exits.\n\
\n\
The option -pid-file writes the process id of the parent spawn\n\
process to the file <pid-file>, creating an exclusive (write)\n\
lock on the file using fnctl(2). This will prevent duplicate\n\
instances of a spawn instance from being started. This file is\n\
clearly useful for terminating the spawn process. The file is\n\
removed on exit. This behaviour is free of race conditions, however\n\
will probably not work well over NFS. By comparison, see uucp(1)\n\
locks.\n\
\n\
REDIRECTING STDOUT\n\
To redirect the stdout of the child processes the signal SIGUSR1(%d)\n\
and SIGUSR2(%d) can be used. SIGUSR2 will redirect stdout to '/dev/null'\n\
where SIGUSR1 will redirect stdout to <std-logfile> as specified in\n\
the input arguments. STDOUT will be derected to '/dev/null' at startup.\n\
", (int) SIGTERM, (int) SIGINT, (int) SIGQUIT, (int) SIGKILL, (int)SIGUSR1, (int)SIGUSR2);
    exit (c);
}

static pid_t
pipe_open (int do_setuid, int *out, const char *file, char *const argv[], char *new_cwd)
{
    pid_t p;
    int f[2];
    if (pipe (f))
        return 0;
    p = fork ();
    if (p == -1) {
        close (f[0]);
        close (f[1]);
        return 0;
    }
    if (p) {
        *out = f[0];
        close (f[1]);
        return p;
    } else {
        char s[80];
        int nulldevice_rd;
        nulldevice_rd = open ("/dev/null", 2 /* O_RDWR */ );    /* some things you can just rely on */
        close (0);
        dup (nulldevice_rd);
        close (nulldevice_rd);
        close (1);
        close (2);
        dup (f[1]);             /* read from both stderr and stdout */
        dup (f[1]);
        close (f[0]);
        close (f[1]);
        chdir (new_cwd);
        if (option_uid >= 0 && do_setuid) {
            sprintf (s, "spawn: cannot setgid/setuid to %ld/%ld", (long) option_gid, (long) option_uid);
            if (setgid (option_gid) || setuid (option_uid))
                perror (s);
            else
                fprintf (stderr, "spawn: setgid/setuid to %ld/%ld: Success\n", (long) option_gid, (long) option_uid);
        }
        execvp (file, argv);
        log_perror (file);
        exit (1);
    }
    return 0;                   /* prevents warning */
}

/* returns strdup of the full path if the file exists in the PATH.
mimicks the behavior of execvp */
static char *
PATH_search (const char *file)
{
    int len;
    int fd;
    char *name = NULL;
    char cwd[1024];
    len = strlen ((char *) file) + 1;
    if (!getcwd (cwd, sizeof (cwd))) {
        log_perror ("getcwd");
        return NULL;
    }
    if (strchr (file, '/')) {   /* don't do a path search */
        name = (char *) malloc (strlen (cwd) + len + 2);
        *name = '\0';
        if (*file != '/') {
            strcpy (name, cwd);
            strcat (name, "/");
        }
        strcat (name, (char *) file);
        if ((fd = open (name, O_RDONLY)) >= 0) {
            close (fd);
            return name;
        }
    } else {
        char *path, *p;
        if ((path = getenv ("PATH"))) {
            int n;
            n = strlen (cwd) + strlen (path) + len + 2;
            name = (char *) malloc (n);
            p = path;
            do {
                path = p;
                if (!(p = strchr (path, ':')))
                    p = path + strlen (path);
                memset (name, '\0', n);
                if (p == path) {        /* double colons */
                    strcat (name, cwd);
                    strcat (name, "/");
                    strcat (name, (char *) file);
                } else {
                    if (*path != '/') {
                        strcat (name, cwd);
                        strcat (name, "/");
                    }
                    strncat (name, path, (int) (p - path));
                    strcat (name, "/");
                    strcat (name, (char *) file);
                }
                if ((fd = open (name, O_RDONLY)) >= 0) {
                    close (fd);
                    return name;
                }
            } while (*p++);
        }
    }
    if (name)
        free (name);
    return NULL;
}

static void
test_gdb (void)
{
    struct stat st;
    if (stat (GDB, &st)) {
        log_perror (GDB);
        exit (1);
    }
    if (!(st.st_mode & 0111)) {
        log_fmt (logfile, 0, "%s: does not have executable permissions", GDB);
        exit (1);
    }
}

static char *
get_exec (char *name)
{
    struct stat st;
    char *server_path;
    server_path = PATH_search (name);
    if (!server_path) {
        log_fmt (logfile, 0, "%s: not found", name);
        exit (1);
    }
    if (stat (server_path, &st)) {
        log_perror (server_path);
        exit (1);
    }
    if (!(st.st_mode & 0111)) {
        log_fmt (logfile, 0, "%s: does not have executable permissions", server_path);
        exit (1);
    }
    return server_path;
}

struct process {
    int out;                    /* output file descriptor of process: stderr and stdout combined */
    char *dir;                  /* temporary current directory */
    char *name;                 /* name of process (without the path) */
    char *sym_link;             /* name in current dir for gdb */
    char *path;                 /* name of process with full path as found by a PATH search */
    char **args;                /* full arg list including process name */
    char *buf;                  /* recv buffer */
    char *log_prefix;           /* "(gdb) " for gdb output, NULL otherwise. */
    char *peer_info_prefix;
    int buf_alloced;            /* amount of bytes allocated to recv buffer */
    int buf_len;                /* number of bytes read */
    int search;                 /* last search offset (for a newline) */
    int got_status;             /* wait() returned */
    int status;                 /* exit status reported by waitpid */
    enum life_state life_state; /* process has been successfully started */
    int no_restart_report;      /* do not repeatedly log an "child died more than..." */
    pid_t pid;                  /* process id of child */
    time_t start_time;          /* time of exec */
    time_t time_of_sigchld;     /* time of death */
    long long last_usec;        /* used for logging deltas */
};

struct process *process_list = NULL;

static int
spawn (struct process *p)
{
    p->log_prefix = NULL;
    mkdir (p->dir, 0777);	//JR case121875 the mode value (permissions) was 0600
    if (option_uid >= 0) {
        if (chown (p->dir, option_uid, option_gid)) {
            log_fmt (logfile, 0, "could not chown directory %s", p->dir);
            log_perror (p->dir);
        }
    }
    symlink (p->path, p->sym_link);
    p->out = -1;
    time (&p->start_time);
    p->pid = pipe_open (1, &p->out, p->path, p->args, p->dir);
    log_fmt (logfile, 0, "starting %s under %s/: %s", p->path, p->dir, p->pid ? "success" : "failed");
    if (!p->pid) {
        log_perror (p->path);
        return 1;
    }
    CHANGE_STATE (p, LIFE_STATE_WAITING_FOR_SIGCHLD);
    return 0;
}

static void
writeall (int fd, char *buf, int l)
{
    lseek (fd, 0, SEEK_END);
    while (l > 0) {
        int c;
        c = write (fd, buf, l);
        if (c <= 0) {
            log_perror ("write");
            return;
        }
        buf += c;
        l -= c;
    }
}

static void
log_fmt (FILE * f, int err, const char *fmt, ...)
{
    struct timeval tp;
    struct timezone tzp;
    static char s[256];
    va_list ap;
    va_start (ap, fmt);
    gettimeofday (&tp, &tzp);
    strftime (s, sizeof (s), "%Y-%m-%d %H:%M:%S", localtime (&tp.tv_sec));
    fprintf (f, "%s%s.%02ld: ", (logfile == stderr) ? "spawn: " : "", s, (long) tp.tv_usec / 10000);
    vfprintf (f, fmt, ap);
    if (err)
        fprintf (f, ": [%s]\n", strerror(err));
    else
        fprintf (f, "\n");
    fflush (f);
    va_end (ap);
}

static void
write_line (int to_stdout, struct process *p, char *line, int line_len)
{
    long long new_usec;
    double diff_sec;
    static char s[65536];
    char ts[32];
    int l, n;
    struct timeval tp;
    struct timezone tzp;
    gettimeofday (&tp, &tzp);

    new_usec = (long long) tp.tv_sec * 10000 + (long long) tp.tv_usec / 100;
    if (new_usec <= p->last_usec)       /* ensure that the time increments by at least one digit for sorting purposes */
        new_usec = p->last_usec + 1;
    diff_sec = (new_usec - p->last_usec);
    diff_sec /= 10000.0;
    tp.tv_sec = (time_t) (new_usec / 10000);
    strftime (ts, sizeof (ts), "%d/%m/%Y|%H:%M:%S", localtime (&tp.tv_sec));
    if (line_len >= TRANSACTION_CONTEXT_SWITCH_MAGIC_N &&
        !strncmp (line, TRANSACTION_CONTEXT_SWITCH_MAGIC_STRING, TRANSACTION_CONTEXT_SWITCH_MAGIC_N)) {
        xfree (p->peer_info_prefix);
        p->peer_info_prefix = (char *) malloc (line_len + 1);
        strncpy (p->peer_info_prefix, line + TRANSACTION_CONTEXT_SWITCH_MAGIC_N, line_len - TRANSACTION_CONTEXT_SWITCH_MAGIC_N);
        p->peer_info_prefix[line_len - TRANSACTION_CONTEXT_SWITCH_MAGIC_N] = '\0';
    }
    sprintf (s, "TR |Uxd:%s.%04ld(%07.3fs)||%s|Hnm:%s|Pid:%ld||%s|%s| ", ts, (long) (new_usec % 10000),
             p->last_usec ? diff_sec : (double) 0.0,
	     p->name,hostname,
	     (long) p->pid,
	     p->peer_info_prefix ? p->peer_info_prefix : "",
             p->log_prefix ? p->log_prefix : "");
    l = strlen (s);
    n = min (line_len, sizeof (s) - l - 1);
    memcpy (s + l, line, n);
    s[l + n] = '\n';
    writeall (to_stdout ? 1 : fileno (logfile), s, l + n + 1);
    p->last_usec = (long long) new_usec;
}

static void
do_gather_output (char **s, char *p, int c)
{
    if (s && c > 0) {
        int l;
        l = strlen (*s);
        *s = (char *) realloc (*s, l + c + 1);
        strncpy (*s + l, p, c);
        (*s)[l + c] = '\0';
    }
}

static void
read_line (int to_stdout, struct process *p, char **gather_output)
{
    int c;
    if (!p->buf || p->buf_alloced == p->buf_len) {
        p->buf_alloced += 1024;
        p->buf = (char *) realloc (p->buf, p->buf_alloced);
    }
    c = read (p->out, p->buf + p->buf_len, p->buf_alloced - p->buf_len);
    do_gather_output (gather_output, p->buf + p->buf_len, c);
    if (c < 0 && errno == EINTR) {
        c = 0;
    } else if (c <= 0) {        /* error or child close file descriptor */
/*        if (p->life_state == LIFE_STATE_WAITING_FOR_FD_CLOSE) */
        CHANGE_STATE(p, LIFE_STATE_FD_CLOSED);
        close (p->out);
        if (option_verbose)
            write (1, "fd closed\n", 10);
        p->out = -1;
        c = 0;
    }
    p->buf_len += c;
    while (p->search < p->buf_len) {
        int n;
        char *q;
        q = (char *) memchr (p->buf + p->search, '\n', p->buf_len - p->search);
        if (!q && p->out == -1) {
            q = p->buf + p->buf_len;
        }
        if (!q) {               /* no EOL found */
            p->search = p->buf_len;
        } else {
            n = (q - p->buf);
            write_line (to_stdout, p, p->buf, n);
            p->buf_len = max (p->buf_len - n - 1, 0);
            memmove (p->buf, q + 1, p->buf_len);        /* shift up the unwritten part of the line */
            p->search = 0;
        }
    }
}

static char *
file_name (char *path)
{
    char *r;
    r = strrchr (path, '/');
    return r ? r + 1 : path;
}

static void
child_handler (int x)
{
    int i, found = 0;
    for (i = 0; i < option_instances; i++) {
        if ((waitpid (process_list[i].pid, &process_list[i].status, WNOHANG)) > 0) {
            found++;
            process_list[i].got_status = 1;
            time (&process_list[i].time_of_sigchld);
            if (process_list[i].life_state == LIFE_STATE_WAITING_FOR_SIGCHLD)
                CHANGE_STATE (&process_list[i], LIFE_STATE_WAITING_FOR_FD_CLOSE);
        }
    }
    if (!found) {
        int status;
        /* gdb exit or process for which the signal was lost before the file descriptor closed */
        wait (&status);
    }
    if (option_verbose)
        write (1, "##########got SIGCHLD\n" + 10 - found, 12 + found);
    signal (SIGCHLD, child_handler);
}

static int
write_file (char *file_name, ...)
{
    char *p;
    int r = 0;
    va_list ap;
    int len = 0, fd;
    va_start (ap, file_name);
    fd = open (file_name, O_RDWR | O_CREAT | O_TRUNC, 0644);
    for (;;) {
        int c;
        if (!len) {
            p = va_arg (ap, char *);
            if (!p)
                return NULL;
            len = strlen (p);
        }
        if (!len)
            continue;
        c = write (fd, p, len);
        if (c <= 0) {
            r = 1;
            break;
        }
        p += c;
        len -= c;
    }
    close (fd);
    va_end (ap);
    return r;
}

static void
envoke_gdb (struct process *p, char *core_file)
{
    int i;
    char cmd_file[256];
    char *trace_back = NULL;
    char **trace_back_p;
    char *a[64];
    FILE *gdb_cmd;
    sprintf (cmd_file, "%s/gdb-cmd", p->dir);
    gdb_cmd = fopen (cmd_file, "w");
    if (!gdb_cmd) {
        log_fmt (logfile, 0, "could not write gdb batch file");
        log_perror (cmd_file);
        return;
    }
    fprintf (gdb_cmd, "info source\n");
    fprintf (gdb_cmd, "info threads\n");
    for (i = 1; i <= 4; i++) {
        fprintf (gdb_cmd, "thread %d\n", i);
        fprintf (gdb_cmd, "bt\n");
    }
    fprintf (gdb_cmd, "quit\n");
    fclose (gdb_cmd);
    log_fmt (logfile, 0, "envoking gdb on core file %s", core_file);
    a[0] = (char *) "gdb";
    a[1] = (char *) "-batch";
    a[2] = (char *) "-x";
    a[3] = cmd_file;
    a[4] = p->path;
    a[5] = core_file;
    a[6] = NULL;
    p->log_prefix = (char *) "(gdb) ";
/**/sleep (2);
    if (pipe_open (1, &p->out, GDB, a, p->dir) <= 0) {
        log_fmt (logfile, 0, "could not envoke gdb");
        log_perror (GDB);
        unlink (cmd_file);
        return;
    }
    trace_back_p = option_mailing_list ? &trace_back : NULL;
    while (p->out >= 0)
        read_line (0, p, trace_back_p);
    if (trace_back_p && trace_back) {
        char mail_file[256];
        char mail_cmd[256];
        sprintf (mail_file, "%s/mail", p->dir);
        write_file (mail_file, "Subject: ", p->path, " died\n\n\n", trace_back, NULL);
        sprintf (mail_cmd, "( cat %s ; echo ; hostname ; date ; ) | mail `<%s`", mail_file, option_mailing_list);
        system (mail_cmd);
        unlink (mail_file);
        free (trace_back);
    }
    unlink (cmd_file);
    if (p->out >= 0)
        close (p->out);
    p->out = -1;
}

static void
analize_core_file (struct process *p)
{
    char core_file[1024];
    struct stat st;
    sprintf (core_file, "%s/core", p->dir);
//  CORE DUMP FOLDER:	/var/lib/systemd/coredump
//  FILE NAME PATTERN:  core.sleep.8376.3e40c56decd24195953bee9008cb5050.8376.11000000.zst
//			where 3 field is the PID.
    if (stat (core_file, &st) && errno == ENOENT) {
        log_fmt (logfile, 0, "pid %ld did not produce a core file %s on exit", (long) p->pid, core_file);
        return;
    }
    envoke_gdb (p, core_file);
    unlink (core_file);
}

/**
 * @brief SIGUSR1 signal handler, will chage stdout to the file specified in the
 *        'stdout.file'
 * @autor JR
 * @since case 121875
 * ********************************************/ 
static void
config_handler1(int sig_num)
{
	int fd;			//file descriptor

	signal(sig_num,config_handler1);	//set signal handler

	if (option_std_output)
	{
		//open stdout file
		fd =  open (option_std_output, O_WRONLY | O_CREAT | O_APPEND | O_LARGEFILE, 0777);
		if (fd <= 0)
		{
			log_perror (option_std_output);
		}
		log_fmt (logfile, 0, "Changing stdout to -> %s",option_std_output);
		close (1);
		dup(fd);
		close(fd);
	}
	else
	{
		log_perror (option_std_output);
	}
}
/**
 * @brief SIGUSR2 signal handler, will chage stdout to '/dev/null'
 * @autor JR
 * @since case 121875
 * ********************************************/ 
static void
config_handler2(int sig_num)
{
	int fd;
	signal(sig_num,config_handler2);

	log_fmt (logfile, 0, "Changing stdout to -> ''/dev/null''");

	fd = open ("/dev/null", O_RDWR);
	close (1);
	dup(fd);
}

static void
exit_handler (int x)
{
    int i;
    do_quit = x;
    for (i = 0; i < option_instances; i++) {
        if (process_list[i].pid > 0)
            kill (process_list[i].pid, x);
        else
            CHANGE_STATE (&process_list[i], LIFE_STATE_NEVER_RESTART);
    }
    time (&death_start_time);
    signal (x, exit_handler);
}

static void
unlink_pid_file_and_exit (int x)
{
    if (option_pid_file)
        if (!unlink (option_pid_file))
            log_fmt (logfile, 0, "removing %s", option_pid_file);
    exit (x);
}

static int
is_number (char *s)
{
    return (strspn (s, "0123456789") == strlen (s));
}

static void
lookup_uid_gid (char *user_string, char *group_string)
{
    struct passwd *p;
    struct group *g;
    if (is_number (user_string)) {
        if (!(p = getpwuid ((uid_t) atol (user_string)))) {
            log_fmt (logfile, 0, "no such uid %s", user_string);
            exit (1);
        }
    } else {
        if (!(p = getpwnam (user_string))) {
            log_fmt (logfile, 0, "no such user name %s", user_string);
            exit (1);
        }
    }
    option_uid = (long) p->pw_uid;

    if (is_number (group_string)) {
        if (!(g = getgrgid ((gid_t) atol (group_string)))) {
            log_fmt (logfile, 0, "no such gid %s", group_string);
            exit (1);
        }
    } else {
        if (!(g = getgrnam (group_string))) {
            log_fmt (logfile, 0, "no such group name %s", group_string);
            exit (1);
        }
    }
    option_gid = (long) g->gr_gid;
}

int
main (int argc, char **argv)
{
    int i, n_undead, std_outputs = -1;
    char **server_args, *server_path, *user_string = NULL, *group_string = NULL;
    int server_argc = 0, in_server_args = 0;
    int HOST;

    HOST = gethostname(hostname,512);
    logfile = stderr;

    if (argc < 2)
        usage_exit (1);

    server_args = (char **) malloc ((argc + 1) * sizeof (char *));
    memset (server_args, '\0', (argc + 1) * sizeof (char *));

#define CHECK(n)                                \
    do {                                        \
        if (!(argc > n))                        \
            usage_exit (1);                     \
    } while (0)

    while (argc > 1) {
        if (in_server_args) {
            server_args[server_argc++] = (char *) strdup (argv[1]);
        } else {
            if (!strncmp (argv[1], "-instances", 4)) {
                CHECK (1);
                option_instances = atoi ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-auto-restart", 4)) {
                option_auto_restart = 1;
            } else if (!strncmp (argv[1], "-verbose", 5)) {
                option_verbose++;
            } else if (!strncmp (argv[1], "-background", 4)) {
                option_background = 1;
            } else if (!strncmp (argv[1], "-log-file", 4)) {
                CHECK (1);
                option_log_file = (char *) strdup ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-std-output-file", 11)) {
                CHECK (1);
                option_std_output = (char *) strdup ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-tmp", 4)) {
                CHECK (1);
                option_tempdir = (char *) strdup ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-pid-file", 4)) {
                CHECK (1);
                option_pid_file = (char *) strdup ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-kill", 4)) {
                CHECK (1);
                option_time_to_send_kill = atoi ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-user", 5)) {
                CHECK (1);
                user_string = (char *) strdup ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-group", 6)) {
                CHECK (1);
                group_string = (char *) strdup ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-mail", 5)) {
                CHECK (1);
                option_mailing_list = (char *) strdup ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-max-restarts", 4)) {
                CHECK (2);
                option_max_restarts_n = atoi ((--argc, ++argv)[1]);
                option_max_restarts_seconds = atoi ((--argc, ++argv)[1]);
            } else if (!strncmp (argv[1], "-help", 5) || !strncmp (argv[1], "--help", 6)) {
                usage_exit (0);
            } else if (!strcmp (argv[1], "--")) {
                in_server_args = 1;
            } else if (!strncmp (argv[1], "-", 1)) {
                usage_exit (1);
            } else {
                usage_exit (1);
            }
        }
        argv++;
        argc--;
    }

    if (!in_server_args)
        usage_exit (1);

    if (option_std_output && !option_background) {
        fprintf (stderr, "spawn: command-line error: option -std-output-file requires -background\n");
        exit (1);
    }

    if (user_string && group_string)
        lookup_uid_gid (user_string, group_string);

    if ((group_string && !user_string) || (!group_string && user_string)) {
        log_fmt (logfile, 0, "both the user and group must be specified");
        exit (1);
    }

    logfile = option_log_file ? fopen (option_log_file, "a+") : stderr;

    test_gdb ();
    server_path = get_exec (server_args[0]);

    /****** JR - case1221875 - always start with stdout to /dev/null *******

    if (option_std_output) {
        std_outputs = open (option_std_output, O_WRONLY | O_CREAT | O_APPEND | O_LARGEFILE, 0644);
        if (std_outputs <= 0) {
            log_perror (option_std_output);
            exit (1);
        }
    }
    ****** end c121875 ******************************** */

    if (option_background) {
        int fd;
        fd = open ("/dev/null", O_RDWR);
        close (0);
        close (1);
        close (2);
        dup (fd);
        dup (std_outputs >= 0 ? std_outputs : fd);
        dup (std_outputs >= 0 ? std_outputs : fd);
        close (std_outputs);
        close (fd);
        if (fork () > 0)
            exit (1);
        if (fork () > 0)
            exit (1);
    } else if (std_outputs >= 0) {
        close (1);
        close (2);
        dup (std_outputs);
        dup (std_outputs);
    }

    if (option_pid_file) {
        int pid_fd;
        char s[32];
        struct flock flk;
        pid_fd = open (option_pid_file, O_RDWR | O_CREAT, 0644);
        if (pid_fd < 0) {
            log_perror (option_pid_file);
            exit (1);
        }
        if (write (pid_fd, " ", 1) != 1) {
            log_perror (option_pid_file);
            exit (1);
        }
        memset (&flk, '\0', sizeof (flk));
        flk.l_type = F_WRLCK;
        flk.l_whence = SEEK_SET;
        flk.l_len = 1;
        if (fcntl (pid_fd, F_SETLK, &flk) == -1) {
            log_fmt (logfile, 0, "write lock could not be obtained on pid file %s, another spawn process is probably already running and using this file", option_pid_file);
            exit (1);
        }
        sprintf (s, " %ld            \n", (long) getpid ());
        write (pid_fd, s, strlen (s));
    }

    signal (SIGCHLD, child_handler);
    signal (SIGTERM, exit_handler);
    signal (SIGINT, exit_handler);
    signal (SIGQUIT, exit_handler);

    //JR c121875 signal handlers add for signal SIGUSR1 and SIGUSR2
    signal (SIGUSR1, config_handler1);
    signal (SIGUSR2, config_handler2);

    process_list = (struct process *) malloc (option_instances * sizeof (struct process));
    memset (process_list, '\0', option_instances * sizeof (struct process));

    n_restarts = 0;
    time (&restart_window_begin);

    for (i = 0; i < option_instances; i++) {
        char s[1024];
        process_list[i].dir = (char *) tempnam (option_tempdir, "spawn");
        process_list[i].name = file_name (server_path);
        process_list[i].path = server_path;
        process_list[i].args = server_args;
        process_list[i].args[0] = process_list[i].name;
        sprintf (s, "%s/%s", process_list[i].dir, process_list[i].name);
        process_list[i].sym_link = (char *) strdup (s);
        if (spawn (&process_list[i]))
            if (!i)
                unlink_pid_file_and_exit (1);
    }

    for (;;) {
        struct timeval tv;
        fd_set rd;
        int max_fd = 0, n_descriptors = 0, n;
        FD_ZERO (&rd);
        if (do_quit > 0) {
            log_fmt (logfile, 0, "received signal %d, sending signal %d to all children", do_quit, do_quit);
            do_quit = -1;       /* don't print the signal again */
        }
        for (i = 0; i < option_instances; i++) {
            struct process *p;
            time_t t;
            time (&t);
            p = &process_list[i];
/* after the child has died, we wait one second to read
any remaining data left in the pipe. the death of the
child should cause a select() on the pipe and a
subsequent failed read() - causing read_line() to close
the pipe and go to the next state - but on HP this does
not happen. Indeed on HP, the child dies without any
response from select(). */
            if ((p->life_state == LIFE_STATE_WAITING_FOR_FD_CLOSE && t > p->time_of_sigchld + 1) || p->life_state == LIFE_STATE_FD_CLOSED) {
                char s[256];
                if (p->out >= 0) {
                    close (p->out);
                    p->out = -1;
                }
/**/if (!p->got_status)
/**/sleep (1);
                if (WIFEXITED (p->status)) {
                    sprintf (s, "exit code %d", (int) WEXITSTATUS (p->status));
                } else {
                    sprintf (s, "on signal %d", (int) WTERMSIG (p->status));
                }
                log_fmt (logfile, 0, "child %s died, pid = %ld, %s, uptime = %lds", p->name, (long) p->pid,
                         s, (long) (t - p->start_time));
                if (!WIFEXITED (p->status))
                    analize_core_file (p);
                unlink (p->sym_link);
                if (rmdir (p->dir)) {
                    log_fmt (logfile, 0, "could not remove directory %s", p->dir);
                    log_perror (p->dir);
                }
                if (do_quit || !option_auto_restart)
                    CHANGE_STATE (p, LIFE_STATE_NEVER_RESTART);
                else
                    CHANGE_STATE (p, LIFE_STATE_READY_TO_RESTART);    /* gdb's usage of read_line above needs this. but its also needed generally */
            }
            if (p->life_state == LIFE_STATE_READY_TO_RESTART) {
                if (do_quit || !option_auto_restart) {
                    CHANGE_STATE (p, LIFE_STATE_NEVER_RESTART);
                } else if (option_max_restarts_seconds) {
                    if (t > restart_window_begin + option_max_restarts_seconds) {
                        n_restarts = 1;
                        restart_window_begin = t;
                    } else {
                        n_restarts++;
                    }
                    if (n_restarts <= option_max_restarts_n) {
                        p->no_restart_report = 0;
                        spawn (p);
                    } else {
                        if (!p->no_restart_report) {
                            p->no_restart_report = 1;
                            log_fmt (logfile, 0, "child died more than %d times in the last %d seconds, not restarting",
                                        option_max_restarts_n, option_max_restarts_seconds);
                        }
                    }
                } else {
                    spawn (p);
                }
            }
            if (p->out >= 0) {
                FD_SET (p->out, &rd);
                max_fd = max (max_fd, p->out);
                n_descriptors++;
            }
        }
        n_undead = 0;
        for (i = 0; i < option_instances; i++)
            n_undead += (process_list[i].life_state != LIFE_STATE_NEVER_RESTART);
        if (!n_undead) {
            log_fmt (logfile, 0, "all children terminated, exitting");
            unlink_pid_file_and_exit (0);
        }
        if (death_start_time && option_time_to_send_kill) {
            time_t t;
            time (&t);
            if (t > death_start_time + option_time_to_send_kill) {
                n_undead = 0;
                for (i = 0; i < option_instances; i++)
                    n_undead += (process_list[i].life_state != LIFE_STATE_NEVER_RESTART);
                if (n_undead) {
                    log_fmt (logfile, 0, "%d of %d children still undead after %d seconds, sending these children SIGKILL(%d)", n_undead,
                             option_instances, option_time_to_send_kill, (int) SIGKILL);
                    for (i = 0; i < option_instances; i++)
                        kill (process_list[i].pid, SIGKILL);
                    time (&kill_9_start_time);
                }
                death_start_time = 0;
            }
        }
        if (kill_9_start_time) {
            time_t t;
            time (&t);
            if (t > kill_9_start_time + 60) {
                n_undead = 0;
                for (i = 0; i < option_instances; i++)
                    n_undead += (process_list[i].life_state != LIFE_STATE_NEVER_RESTART);
                if (n_undead) {
                    log_fmt (logfile, 0, "%d of %d children still undead after %d seconds, this is an OS bug, exitting", n_undead,
                             option_instances, option_time_to_send_kill + 60);
                    exit (1);
                }
            }
        }
        tv.tv_sec = 0;
        tv.tv_usec = 100000;
        if ((n = select (max_fd + 1, &rd, NULL, NULL, &tv)) < 0 && errno != EINTR) {
            log_perror ("select");
            unlink_pid_file_and_exit (1);
        }
        if (n <= 0)
            FD_ZERO (&rd);
        for (i = 0; i < option_instances; i++) {
            if (process_list[i].out >= 0) {
                if (FD_ISSET (process_list[i].out, &rd)) {
                    read_line (1, &process_list[i], NULL);
                }
            }
        }
    }
    unlink_pid_file_and_exit (0);
    return 0;                   /* not reached */
}


