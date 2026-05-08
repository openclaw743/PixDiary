variable "name_prefix" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type    = string
  default = "global"
}

variable "tags" {
  type    = map(string)
  default = {}
}
