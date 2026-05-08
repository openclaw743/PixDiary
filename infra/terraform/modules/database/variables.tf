variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "postgres_subnet_id" {
  type        = string
  description = "Subnet ID delegated to Microsoft.DBforPostgreSQL/flexibleServers"
}

variable "postgres_private_dns_zone_id" {
  type = string
}

variable "admin_username" {
  type    = string
  default = "pixdiaryadmin"
}

variable "database_name" {
  type    = string
  default = "pixdiary"
}

variable "tags" {
  type    = map(string)
  default = {}
}
