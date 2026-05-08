terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend wiring left to TechLead at apply time:
  #   terraform init -backend-config=backend.dev.hcl
  # Example backend.dev.hcl (do not commit secrets):
  #   resource_group_name  = "rg-Sandbox"
  #   storage_account_name = "sttfstatepixdiary"
  #   container_name       = "tfstate"
  #   key                  = "pixdiary/dev.tfstate"
  #   use_azuread_auth     = true
  backend "azurerm" {}
}

provider "azurerm" {
  subscription_id = var.subscription_id
  features {
    key_vault {
      purge_soft_delete_on_destroy    = true
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}

provider "random" {}
