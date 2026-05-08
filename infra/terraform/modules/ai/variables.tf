variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "gpt_4o_mini_capacity" {
  type        = number
  default     = 50
  description = "Tokens-per-minute capacity (k TPM) for gpt-4o-mini deployment"
}

variable "gpt_4o_capacity" {
  type        = number
  default     = 10
  description = "Tokens-per-minute capacity (k TPM) for gpt-4o escalation deployment"
}

variable "tags" {
  type    = map(string)
  default = {}
}
