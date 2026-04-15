
/* The following lines are extremely important. The spawn process picks these up: */
#define TRANSACTION_CONTEXT_SWITCH_MAGIC_STRING "New transaction context PREFIX=%s"
/* Search for 'New transaction context PREFIX=' = 31 chars */
#define TRANSACTION_CONTEXT_SWITCH_MAGIC_N      31

