"""Checks on deploy/deploy.sh that do not need a Google Cloud account."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "deploy", "deploy.sh")
SETUP = os.path.join(HERE, "..", "deploy", "setup-github-deploy.sh")
WORKFLOW = os.path.join(HERE, "..", ".github", "workflows", "deploy.yml")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class DeployScript(unittest.TestCase):
    def setUp(self):
        with open(SCRIPT, encoding="utf-8") as f:
            self.text = f.read()

    def test_env_var_delimiter_cannot_appear_in_emails(self):
        # gcloud reads "^X^A=1XB=2" as two variables split on X. The value of ALLOWED_EMAILS is a
        # comma-separated list of addresses, so X must be neither "@" nor "," (the first deploy failed
        # with "Bad syntax for dict arg: [gmail.com]" when X was "@").
        found = re.findall(r'--set-env-vars\s+"\^(.)\^([^"]*)"', self.text)
        self.assertTrue(found, "the service deploy sets its variables with a custom delimiter")
        for delim, body in found:
            self.assertNotIn(delim, "@,.-_+", f"delimiter {delim!r} can occur in an email address")
            parts = body.split(delim)
            self.assertEqual([p.split("=", 1)[0] for p in parts], ["OPCG_DATA", "ALLOWED_EMAILS"])
            emails = parts[1].split("=", 1)[1].replace("$EMAIL", "a.b@gmail.com,c@gmail.com")
            self.assertEqual(emails.split(","), ["a.b@gmail.com", "c@gmail.com"])

    def test_build_account_gets_the_builder_role_before_deploying(self):
        # The first real deploy stopped with "...-compute@developer.gserviceaccount.com does not have
        # storage.objects.get access": source builds need roles/run.builder on that account.
        grant = self.text.find("--role=roles/run.builder")
        deploy = self.text.find('gcloud run deploy "$SERVICE"')
        self.assertGreater(grant, 0)
        self.assertLess(grant, deploy, "the role must be granted before the service is built")
        self.assertIn('-compute@developer.gserviceaccount.com"', self.text)

    def test_iap_is_switched_on_and_can_reach_the_service_for_every_account_type(self):
        # A personal account once ended at Cloud Run's own 403 page: IAP had not been switched on,
        # and the IAP service agent was only allowed to call the service in Workspace mode.
        deploy = self.text[self.text.find('gcloud run deploy "$SERVICE"'):]
        self.assertIn("--iap", deploy[:deploy.find("--set-env-vars")])
        invoker = self.text.find("gcp-sa-iap.iam.gserviceaccount.com")
        self.assertGreater(invoker, 0)
        self.assertLess(invoker, self.text.find('if [ "$IAP_SETUP" = console ]'),
                        "the IAP agent must get run.invoker before (outside) the account-type branch")

    def test_personal_accounts_are_asked_for_a_custom_oauth_client(self):
        # With the Google-managed client, IAP said "You don't have access" to the allowed Gmail account.
        self.assertIn("oauthSettings.clientId", self.text)
        self.assertIn("gcloud iap settings set", self.text)
        self.assertIn("handleRedirect", self.text)

    def test_old_images_are_cleaned_up_without_stopping_the_deploy(self):
        start = self.text.find("set-cleanup-policies")
        self.assertGreater(start, 0)
        line_end = self.text.find("rm -f", start)
        self.assertIn("|| echo", self.text[start:line_end], "a failed cleanup setting must not stop the deploy")
        self.assertIn('"keepCount": 2', self.text)


class GitHubDeploy(unittest.TestCase):
    """Automatic deploys from GitHub: keyless, main only, idle until set up."""

    def setUp(self):
        self.setup, self.flow = read(SETUP), read(WORKFLOW)

    def test_only_this_repository_and_its_main_branch_can_deploy(self):
        self.assertIn("assertion.repository=='${REPO}' && assertion.ref=='refs/heads/main'", self.setup)
        self.assertIn('REPO="${REPO:-cyrushop/card}"', self.setup)
        self.assertIn("attribute.repository/${REPO}", self.setup)

    def test_no_long_lived_key_is_made(self):
        self.assertNotIn("keys create", self.setup)
        self.assertNotIn("credentials_json", self.flow)
        self.assertIn("id-token: write", self.flow)

    def test_deploys_only_after_tests_pass_on_a_push_to_main(self):
        self.assertIn("workflows: [tests]", self.flow)
        self.assertIn("branches: [main]", self.flow)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", self.flow)
        self.assertIn("github.event.workflow_run.event == 'push'", self.flow)
        # The tests workflow it waits for must really be called "tests".
        self.assertTrue(read(os.path.join(HERE, "..", ".github", "workflows", "tests.yml")).startswith("name: tests\n"))

    def test_does_nothing_until_the_settings_file_exists(self):
        self.assertIn("if [ ! -f deploy/github-deploy.env ]", self.flow)
        gated = [l for l in self.flow.splitlines() if l.strip().startswith("- uses: google-github-actions/")
                 or l.strip().startswith("- name: Deploy") or l.strip().startswith("- name: Run a full update")]
        self.assertEqual(len(gated), 4)
        self.assertEqual(self.flow.count("if: steps.cfg.outputs.ready == 'true'"), 5)

    def test_names_match_the_setup_script(self):
        self.assertIn('POOL="github"', self.setup)
        self.assertIn('PROVIDER="card-repo"', self.setup)
        self.assertIn('SA_NAME="github-deploy"', self.setup)
        self.assertIn("workloadIdentityPools/github/providers/card-repo", self.flow)
        self.assertIn("service_account: github-deploy@", self.flow)
        for key in ("GCP_PROJECT=", "GCP_PROJECT_NUMBER=", "GCP_REGION=", "GCP_SERVICE="):
            self.assertIn(key, self.setup)


if __name__ == "__main__":
    unittest.main(verbosity=2)
