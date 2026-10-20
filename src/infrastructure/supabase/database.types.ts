export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      budget_allocations: {
        Row: {
          budget_bucket_id: string;
          budget_period_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          percentage_basis_points: number;
          updated_at: string;
        };
        Insert: {
          budget_bucket_id: string;
          budget_period_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          percentage_basis_points: number;
          updated_at?: string;
        };
        Update: {
          budget_bucket_id?: string;
          budget_period_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          percentage_basis_points?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_allocations_bucket_fkey';
            columns: ['budget_bucket_id'];
            isOneToOne: false;
            referencedRelation: 'budget_buckets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_allocations_period_fkey';
            columns: ['budget_period_id'];
            isOneToOne: false;
            referencedRelation: 'budget_periods';
            referencedColumns: ['id'];
          },
        ];
      };
      budget_buckets: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          profile_id: string;
          system_key: string | null;
          type: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name: string;
          profile_id: string;
          system_key?: string | null;
          type: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name?: string;
          profile_id?: string;
          system_key?: string | null;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_buckets_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      budget_period_carry_reversals: {
        Row: {
          disposition_id: string;
          id: string;
          owner_profile_id: string;
          reopening_id: string;
          request_payload: Json;
          reversed_at: string;
        };
        Insert: {
          disposition_id: string;
          id: string;
          owner_profile_id: string;
          reopening_id: string;
          request_payload: Json;
          reversed_at?: string;
        };
        Update: {
          disposition_id?: string;
          id?: string;
          owner_profile_id?: string;
          reopening_id?: string;
          request_payload?: Json;
          reversed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_period_carry_reversals_disposition_id_fkey';
            columns: ['disposition_id'];
            isOneToOne: true;
            referencedRelation: 'budget_period_dispositions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_period_carry_reversals_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_period_carry_reversals_reopening_id_fkey';
            columns: ['reopening_id'];
            isOneToOne: true;
            referencedRelation: 'budget_period_reopenings';
            referencedColumns: ['id'];
          },
        ];
      };
      budget_period_closures: {
        Row: {
          budget_period_id: string;
          closed_at: string;
          expected_lifecycle_version: number;
          financial_timezone: string;
          id: string;
          lifecycle_version: number;
          owner_profile_id: string;
          snapshot_hash: string;
          snapshot_version: number;
          summary: Json;
        };
        Insert: {
          budget_period_id: string;
          closed_at: string;
          expected_lifecycle_version: number;
          financial_timezone: string;
          id: string;
          lifecycle_version: number;
          owner_profile_id: string;
          snapshot_hash: string;
          snapshot_version?: number;
          summary: Json;
        };
        Update: {
          budget_period_id?: string;
          closed_at?: string;
          expected_lifecycle_version?: number;
          financial_timezone?: string;
          id?: string;
          lifecycle_version?: number;
          owner_profile_id?: string;
          snapshot_hash?: string;
          snapshot_version?: number;
          summary?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_period_closures_budget_period_id_owner_profile_id_fkey';
            columns: ['budget_period_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'budget_periods';
            referencedColumns: ['id', 'profile_id'];
          },
        ];
      };
      budget_period_dispositions: {
        Row: {
          action: string;
          amount_minor: number;
          closure_id: string;
          created_at: string;
          currency: string;
          destination_bucket_id: string | null;
          destination_bucket_name: string | null;
          destination_period_id: string | null;
          id: string;
          owner_profile_id: string;
          request_payload: Json;
          savings_transaction_id: string | null;
          source_period_id: string;
        };
        Insert: {
          action: string;
          amount_minor: number;
          closure_id: string;
          created_at?: string;
          currency: string;
          destination_bucket_id?: string | null;
          destination_bucket_name?: string | null;
          destination_period_id?: string | null;
          id: string;
          owner_profile_id: string;
          request_payload: Json;
          savings_transaction_id?: string | null;
          source_period_id: string;
        };
        Update: {
          action?: string;
          amount_minor?: number;
          closure_id?: string;
          created_at?: string;
          currency?: string;
          destination_bucket_id?: string | null;
          destination_bucket_name?: string | null;
          destination_period_id?: string | null;
          id?: string;
          owner_profile_id?: string;
          request_payload?: Json;
          savings_transaction_id?: string | null;
          source_period_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_period_dispositions_closure_id_fkey';
            columns: ['closure_id'];
            isOneToOne: true;
            referencedRelation: 'budget_period_closures';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_period_dispositions_destination_bucket_id_fkey';
            columns: ['destination_bucket_id'];
            isOneToOne: false;
            referencedRelation: 'budget_buckets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_period_dispositions_destination_period_id_owner_pro_fkey';
            columns: ['destination_period_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'budget_periods';
            referencedColumns: ['id', 'profile_id'];
          },
          {
            foreignKeyName: 'budget_period_dispositions_savings_transaction_id_fkey';
            columns: ['savings_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'budget_period_dispositions_source_period_id_owner_profile__fkey';
            columns: ['source_period_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'budget_periods';
            referencedColumns: ['id', 'profile_id'];
          },
        ];
      };
      budget_period_reopenings: {
        Row: {
          budget_period_id: string;
          closed_state_hash: string;
          closure_id: string | null;
          expected_lifecycle_version: number;
          id: string;
          lifecycle_version: number;
          owner_profile_id: string;
          previous_closed_at: string;
          reopened_at: string;
        };
        Insert: {
          budget_period_id: string;
          closed_state_hash: string;
          closure_id?: string | null;
          expected_lifecycle_version: number;
          id: string;
          lifecycle_version: number;
          owner_profile_id: string;
          previous_closed_at: string;
          reopened_at: string;
        };
        Update: {
          budget_period_id?: string;
          closed_state_hash?: string;
          closure_id?: string | null;
          expected_lifecycle_version?: number;
          id?: string;
          lifecycle_version?: number;
          owner_profile_id?: string;
          previous_closed_at?: string;
          reopened_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_period_reopenings_budget_period_id_owner_profile_id_fkey';
            columns: ['budget_period_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'budget_periods';
            referencedColumns: ['id', 'profile_id'];
          },
          {
            foreignKeyName: 'budget_period_reopenings_closure_id_fkey';
            columns: ['closure_id'];
            isOneToOne: false;
            referencedRelation: 'budget_period_closures';
            referencedColumns: ['id'];
          },
        ];
      };
      budget_periods: {
        Row: {
          base_currency: string;
          closed_at: string | null;
          created_at: string;
          ends_on: string;
          expected_income_minor: number | null;
          id: string;
          lifecycle_version: number;
          profile_id: string;
          starts_on: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          base_currency: string;
          closed_at?: string | null;
          created_at?: string;
          ends_on: string;
          expected_income_minor?: number | null;
          id?: string;
          lifecycle_version?: number;
          profile_id: string;
          starts_on: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          base_currency?: string;
          closed_at?: string | null;
          created_at?: string;
          ends_on?: string;
          expected_income_minor?: number | null;
          id?: string;
          lifecycle_version?: number;
          profile_id?: string;
          starts_on?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'budget_periods_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      categories: {
        Row: {
          archived_at: string | null;
          budget_bucket_id: string | null;
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          profile_id: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          budget_bucket_id?: string | null;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name: string;
          profile_id: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          budget_bucket_id?: string | null;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          name?: string;
          profile_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_bucket_owner_fkey';
            columns: ['budget_bucket_id', 'profile_id'];
            isOneToOne: false;
            referencedRelation: 'budget_buckets';
            referencedColumns: ['id', 'profile_id'];
          },
          {
            foreignKeyName: 'categories_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      household_members: {
        Row: {
          household_id: string;
          id: string;
          joined_at: string;
          left_at: string | null;
          profile_id: string;
          role: string;
        };
        Insert: {
          household_id: string;
          id?: string;
          joined_at?: string;
          left_at?: string | null;
          profile_id: string;
          role: string;
        };
        Update: {
          household_id?: string;
          id?: string;
          joined_at?: string;
          left_at?: string | null;
          profile_id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_members_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      households: {
        Row: {
          created_at: string;
          created_by: string;
          default_currency: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          default_currency: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          default_currency?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'households_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          base_currency: string;
          created_at: string;
          display_name: string;
          id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          base_currency: string;
          created_at?: string;
          display_name: string;
          id: string;
          timezone: string;
          updated_at?: string;
        };
        Update: {
          base_currency?: string;
          created_at?: string;
          display_name?: string;
          id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      recurring_expenses: {
        Row: {
          active_from: string;
          active_until: string | null;
          amount_mode: string;
          category_id: string;
          created_at: string;
          currency: string;
          default_amount_minor: number | null;
          due_day: number;
          frequency: string;
          id: string;
          name: string;
          owner_profile_id: string;
          scope: string;
          stopped_at: string | null;
          stopped_from: string | null;
        };
        Insert: {
          active_from: string;
          active_until?: string | null;
          amount_mode: string;
          category_id: string;
          created_at?: string;
          currency: string;
          default_amount_minor?: number | null;
          due_day: number;
          frequency?: string;
          id?: string;
          name: string;
          owner_profile_id: string;
          scope?: string;
          stopped_at?: string | null;
          stopped_from?: string | null;
        };
        Update: {
          active_from?: string;
          active_until?: string | null;
          amount_mode?: string;
          category_id?: string;
          created_at?: string;
          currency?: string;
          default_amount_minor?: number | null;
          due_day?: number;
          frequency?: string;
          id?: string;
          name?: string;
          owner_profile_id?: string;
          scope?: string;
          stopped_at?: string | null;
          stopped_from?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'recurring_expenses_category_owner_fkey';
            columns: ['category_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id', 'profile_id'];
          },
          {
            foreignKeyName: 'recurring_expenses_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      savings_goals: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          name: string;
          owner_profile_id: string;
          scope: string;
          target_amount_minor: number;
          target_date: string | null;
        };
        Insert: {
          created_at?: string;
          currency: string;
          id?: string;
          name: string;
          owner_profile_id: string;
          scope?: string;
          target_amount_minor: number;
          target_date?: string | null;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          name?: string;
          owner_profile_id?: string;
          scope?: string;
          target_amount_minor?: number;
          target_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'savings_goals_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      transaction_revisions: {
        Row: {
          action: string;
          actor_profile_id: string | null;
          after_state: Json;
          before_state: Json;
          owner_profile_id: string;
          recorded_at: string;
          request_id: string | null;
          request_payload: Json | null;
          revision: number;
          transaction_id: string;
        };
        Insert: {
          action: string;
          actor_profile_id?: string | null;
          after_state: Json;
          before_state: Json;
          owner_profile_id: string;
          recorded_at?: string;
          request_id?: string | null;
          request_payload?: Json | null;
          revision: number;
          transaction_id: string;
        };
        Update: {
          action?: string;
          actor_profile_id?: string | null;
          after_state?: Json;
          before_state?: Json;
          owner_profile_id?: string;
          recorded_at?: string;
          request_id?: string | null;
          request_payload?: Json | null;
          revision?: number;
          transaction_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transaction_revisions_transaction_id_owner_profile_id_fkey';
            columns: ['transaction_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id', 'owner_profile_id'];
          },
        ];
      };
      transactions: {
        Row: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          recurring_month: string | null;
          recurring_template_id: string | null;
          revision: number;
          savings_goal_id: string | null;
          savings_validated: boolean;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        Insert: {
          amount_minor: number;
          budget_period_id: string;
          category_id?: string | null;
          created_at?: string;
          currency: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          owner_profile_id: string;
          recurring_month?: string | null;
          recurring_template_id?: string | null;
          revision?: number;
          savings_goal_id?: string | null;
          savings_validated?: boolean;
          scope?: string;
          transaction_date: string;
          type: string;
          updated_at?: string;
          withdrawal_confirmed?: boolean;
        };
        Update: {
          amount_minor?: number;
          budget_period_id?: string;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          owner_profile_id?: string;
          recurring_month?: string | null;
          recurring_template_id?: string | null;
          revision?: number;
          savings_goal_id?: string | null;
          savings_validated?: boolean;
          scope?: string;
          transaction_date?: string;
          type?: string;
          updated_at?: string;
          withdrawal_confirmed?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_category_owner_fkey';
            columns: ['category_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id', 'profile_id'];
          },
          {
            foreignKeyName: 'transactions_goal_owner_fkey';
            columns: ['savings_goal_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'savings_goals';
            referencedColumns: ['id', 'owner_profile_id'];
          },
          {
            foreignKeyName: 'transactions_owner_profile_id_fkey';
            columns: ['owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_period_owner_fkey';
            columns: ['budget_period_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'budget_periods';
            referencedColumns: ['id', 'profile_id'];
          },
          {
            foreignKeyName: 'transactions_recurring_owner_fkey';
            columns: ['recurring_template_id', 'owner_profile_id'];
            isOneToOne: false;
            referencedRelation: 'recurring_expenses';
            referencedColumns: ['id', 'owner_profile_id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      close_and_dispose_personal_remainder: {
        Args: {
          p_action: string;
          p_amount_minor: number;
          p_budget_period_id: string;
          p_confirmed?: boolean;
          p_destination_bucket_id?: string;
          p_destination_period_id?: string;
          p_expected_lifecycle_version: number;
          p_id: string;
          p_preview_hash: string;
        };
        Returns: Json;
      };
      close_personal_budget_period: {
        Args: {
          p_budget_period_id: string;
          p_confirmed: boolean;
          p_expected_lifecycle_version: number;
          p_id: string;
          p_snapshot_hash: string;
        };
        Returns: Json;
      };
      correct_personal_transaction: {
        Args: {
          p_action: string;
          p_changes: Json;
          p_confirmed?: boolean;
          p_expected_revision: number;
          p_request_id: string;
          p_transaction_id: string;
        };
        Returns: Json;
      };
      create_personal_recurring_expense: {
        Args: {
          p_active_from: string;
          p_active_until?: string;
          p_amount_mode: string;
          p_category_id: string;
          p_currency: string;
          p_default_amount_minor?: number;
          p_due_day: number;
          p_name: string;
          p_template_id: string;
        };
        Returns: {
          active_from: string;
          active_until: string | null;
          amount_mode: string;
          category_id: string;
          created_at: string;
          currency: string;
          default_amount_minor: number | null;
          due_day: number;
          frequency: string;
          id: string;
          name: string;
          owner_profile_id: string;
          scope: string;
          stopped_at: string | null;
          stopped_from: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'recurring_expenses';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_personal_savings_goal: {
        Args: {
          p_currency: string;
          p_goal_id: string;
          p_name: string;
          p_target_amount_minor: number;
          p_target_date?: string;
        };
        Returns: {
          created_at: string;
          currency: string;
          id: string;
          name: string;
          owner_profile_id: string;
          scope: string;
          target_amount_minor: number;
          target_date: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'savings_goals';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_bucket_consumption: {
        Args: { p_budget_period_id: string };
        Returns: Json;
      };
      get_personal_carry: {
        Args: { p_budget_period_id: string };
        Returns: Json;
      };
      get_personal_carry_reversal_context: {
        Args: { p_disposition_id: string };
        Returns: Json;
      };
      get_personal_committed_money: {
        Args: { p_budget_period_id: string };
        Returns: Json;
      };
      get_personal_dashboard: { Args: { p_month: string }; Returns: Json };
      get_personal_period_close_context: {
        Args: { p_month: string };
        Returns: Json;
      };
      get_personal_recurring_month: {
        Args: { p_month: string };
        Returns: Json;
      };
      get_personal_remainder_context: {
        Args: { p_month: string };
        Returns: Json;
      };
      get_personal_safe_to_spend: {
        Args: { p_budget_period_id: string };
        Returns: Json;
      };
      get_personal_savings_goals: {
        Args: { p_through_month: string };
        Returns: Json;
      };
      get_received_income: {
        Args: { p_budget_period_id: string };
        Returns: number;
      };
      get_savings_availability: {
        Args: { p_budget_period_id: string };
        Returns: Json;
      };
      lock_personal_finance: { Args: never; Returns: undefined };
      prepare_initial_budget_buckets: {
        Args: never;
        Returns: {
          archived_at: string | null;
          created_at: string;
          id: string;
          is_system: boolean;
          name: string;
          profile_id: string;
          system_key: string | null;
          type: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'budget_buckets';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      register_income: {
        Args: {
          p_amount_minor: number;
          p_budget_period_id: string;
          p_currency: string;
          p_description?: string;
          p_transaction_date: string;
          p_transaction_id: string;
        };
        Returns: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          recurring_month: string | null;
          recurring_template_id: string | null;
          revision: number;
          savings_goal_id: string | null;
          savings_validated: boolean;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        SetofOptions: {
          from: '*';
          to: 'transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      register_personal_expense: {
        Args: {
          p_amount_minor: number;
          p_budget_period_id: string;
          p_category_id: string;
          p_currency: string;
          p_description?: string;
          p_transaction_date: string;
          p_transaction_id: string;
        };
        Returns: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          recurring_month: string | null;
          recurring_template_id: string | null;
          revision: number;
          savings_goal_id: string | null;
          savings_validated: boolean;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        SetofOptions: {
          from: '*';
          to: 'transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      register_savings_movement: {
        Args: {
          p_amount_minor: number;
          p_budget_period_id: string;
          p_currency: string;
          p_description?: string;
          p_savings_goal_id?: string;
          p_transaction_date: string;
          p_transaction_id: string;
          p_type: string;
          p_withdrawal_confirmed?: boolean;
        };
        Returns: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          recurring_month: string | null;
          recurring_template_id: string | null;
          revision: number;
          savings_goal_id: string | null;
          savings_validated: boolean;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        SetofOptions: {
          from: '*';
          to: 'transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reopen_personal_budget_period: {
        Args: {
          p_budget_period_id: string;
          p_closed_state_hash: string;
          p_confirmed: boolean;
          p_expected_lifecycle_version: number;
          p_id: string;
        };
        Returns: Json;
      };
      resolve_personal_recurring_expense: {
        Args: {
          p_amount_minor: number;
          p_budget_period_id: string;
          p_currency: string;
          p_description?: string;
          p_month: string;
          p_template_id: string;
          p_transaction_date: string;
          p_transaction_id: string;
        };
        Returns: {
          amount_minor: number;
          budget_period_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          owner_profile_id: string;
          recurring_month: string | null;
          recurring_template_id: string | null;
          revision: number;
          savings_goal_id: string | null;
          savings_validated: boolean;
          scope: string;
          transaction_date: string;
          type: string;
          updated_at: string;
          withdrawal_confirmed: boolean;
        };
        SetofOptions: {
          from: '*';
          to: 'transactions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reverse_carry_and_reopen_personal_period: {
        Args: {
          p_confirmed: boolean;
          p_disposition_id: string;
          p_expected_destination_version: number;
          p_expected_source_version: number;
          p_id: string;
          p_preview_hash: string;
        };
        Returns: Json;
      };
      save_budget_allocations: {
        Args: { p_allocations: Json; p_budget_period_id: string };
        Returns: {
          budget_bucket_id: string;
          budget_period_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          percentage_basis_points: number;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'budget_allocations';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      save_initial_budget: {
        Args: {
          p_allocations?: Json;
          p_base_currency: string;
          p_expected_income_minor?: number;
          p_starts_on: string;
        };
        Returns: {
          base_currency: string;
          closed_at: string | null;
          created_at: string;
          ends_on: string;
          expected_income_minor: number | null;
          id: string;
          lifecycle_version: number;
          profile_id: string;
          starts_on: string;
          status: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'budget_periods';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      stop_personal_recurring_expense: {
        Args: { p_stopped_from: string; p_template_id: string };
        Returns: {
          active_from: string;
          active_until: string | null;
          amount_mode: string;
          category_id: string;
          created_at: string;
          currency: string;
          default_amount_minor: number | null;
          due_day: number;
          frequency: string;
          id: string;
          name: string;
          owner_profile_id: string;
          scope: string;
          stopped_at: string | null;
          stopped_from: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'recurring_expenses';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
