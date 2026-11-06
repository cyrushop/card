"""Checks on deploy/deploy.sh that do not need a Google Cloud account."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "deploy", "deploy.sh")


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
