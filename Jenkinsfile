/* ============================================================
 * SMART EVENT MANAGEMENT PORTAL — Jenkinsfile
 * Declarative Pipeline
 *
 * Stages:
 *   1. Checkout
 *   2. Build Backend Image
 *   3. Build Frontend Image
 *   4. Test
 *   5. Docker Push
 *   6. Deploy to Kubernetes  (graceful skip if kubectl unavailable)
 *   7. Verify Deployment     (graceful skip if kubectl unavailable)
 * ============================================================ */

pipeline {

    agent any

    /* ── Environment variables ─────────────────────────────── */
    environment {
        DOCKERHUB_USER     = 'soum1602'
        BACKEND_IMAGE      = "${DOCKERHUB_USER}/eventportal-backend"
        FRONTEND_IMAGE     = "${DOCKERHUB_USER}/eventportal-frontend"
        IMAGE_TAG          = 'v1'
        DOCKER_CREDENTIALS = 'dockerhub-credentials'   // Jenkins credential ID
    }

    options {
        timestamps()
        timeout(time: 20, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    stages {

        /* ── 1. Checkout ───────────────────────────────────── */
        stage('Checkout') {
            steps {
                echo '>>> Checking out source code from GitHub...'
                checkout scm
                echo ">>> Branch: ${env.GIT_BRANCH}  Commit: ${env.GIT_COMMIT?.take(8)}"
            }
        }

        /* ── 2. Build Backend Image ────────────────────────── */
        stage('Build Backend Image') {
            steps {
                echo ">>> Building backend image: ${BACKEND_IMAGE}:${IMAGE_TAG}"
                sh """
                    docker build \
                        --no-cache \
                        -t ${BACKEND_IMAGE}:${IMAGE_TAG} \
                        ./backend
                """
                echo '>>> Backend image built successfully.'
            }
        }

        /* ── 3. Build Frontend Image ───────────────────────── */
        stage('Build Frontend Image') {
            steps {
                echo ">>> Building frontend image: ${FRONTEND_IMAGE}:${IMAGE_TAG}"
                sh """
                    docker build \
                        --no-cache \
                        -t ${FRONTEND_IMAGE}:${IMAGE_TAG} \
                        ./frontend
                """
                echo '>>> Frontend image built successfully.'
            }
        }

        /* ── 4. Test ───────────────────────────────────────── */
        stage('Test') {
            steps {
                echo '>>> Running smoke test against the backend container...'
                sh """
                    docker rm -f semp-smoke-test 2>/dev/null || true

                    docker run -d \
                        --name semp-smoke-test \
                        -p 5999:5000 \
                        -e FLASK_DEBUG=0 \
                        ${BACKEND_IMAGE}:${IMAGE_TAG}

                    echo "Waiting for backend to initialise..."
                    sleep 8

                    echo "Hitting /api/health..."
                    HTTP_STATUS=\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5999/api/health)

                    docker rm -f semp-smoke-test 2>/dev/null || true

                    if [ "\$HTTP_STATUS" = "200" ]; then
                        echo "Smoke test PASSED — /api/health returned 200."
                    else
                        echo "Smoke test FAILED — /api/health returned HTTP \$HTTP_STATUS"
                        exit 1
                    fi
                """
            }
        }

        /* ── 5. Docker Push ────────────────────────────────── */
        stage('Docker Push') {
            steps {
                echo '>>> Logging in to Docker Hub and pushing images...'
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKER_CREDENTIALS}",
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKER_PASS'
                    )
                ]) {
                    sh """
                        echo \$DOCKER_PASS | docker login -u \$DOCKER_USER --password-stdin

                        docker push ${BACKEND_IMAGE}:${IMAGE_TAG}
                        docker push ${FRONTEND_IMAGE}:${IMAGE_TAG}

                        docker logout
                    """
                }
                echo ">>> Pushed ${BACKEND_IMAGE}:${IMAGE_TAG}"
                echo ">>> Pushed ${FRONTEND_IMAGE}:${IMAGE_TAG}"
            }
        }

        /* ── 6. Deploy to Kubernetes ───────────────────────── */
        stage('Deploy to Kubernetes') {
            steps {
                script {
                    try {
                        echo '>>> Checking kubectl availability...'
                        sh 'kubectl version --client'

                        echo '>>> Applying Kubernetes manifests from k8s/ ...'
                        sh 'kubectl apply -f k8s/'

                        echo '>>> Waiting for rollouts...'
                        sh 'kubectl rollout status deployment/backend-deployment  --timeout=90s'
                        sh 'kubectl rollout status deployment/frontend-deployment --timeout=90s'

                        echo '>>> Deploy to Kubernetes completed successfully.'
                    } catch (Exception e) {
                        echo """
                        ⚠️  kubectl not available in this Jenkins environment — skipping live deploy.
                            Manifests are present in /k8s for manual apply.
                            Run manually:  kubectl apply -f k8s/
                            Error detail:  ${e.getMessage()}
                        """
                        currentBuild.result = 'UNSTABLE'
                    }
                }
            }
        }

        /* ── 7. Verify Deployment ──────────────────────────── */
        stage('Verify Deployment') {
            steps {
                script {
                    try {
                        echo '>>> Verifying pod and service status...'
                        sh """
                            echo "\\n=== Pods ==="
                            kubectl get pods -o wide

                            echo "\\n=== Services ==="
                            kubectl get services

                            echo "\\n=== Deployments ==="
                            kubectl get deployments
                        """
                    } catch (Exception e) {
                        echo """
                        ⚠️  kubectl not available — skipping live verification.
                            Once kubectl is configured, run:  kubectl get pods
                            Error detail:  ${e.getMessage()}
                        """
                        currentBuild.result = 'UNSTABLE'
                    }
                }
            }
        }

    } // end stages

    /* ── Post-build actions ────────────────────────────────── */
    post {

        success {
            echo """
            ╔══════════════════════════════════════════════════╗
            ║   ✅  PIPELINE SUCCEEDED                         ║
            ║                                                  ║
            ║   Images pushed to Docker Hub:                  ║
            ║   • ${BACKEND_IMAGE}:${IMAGE_TAG}
            ║   • ${FRONTEND_IMAGE}:${IMAGE_TAG}
            ║                                                  ║
            ║   To deploy manually:                           ║
            ║     kubectl apply -f k8s/                       ║
            ║   Frontend (after deploy):                      ║
            ║     http://<node-ip>:30080                      ║
            ╚══════════════════════════════════════════════════╝
            """
        }

        failure {
            echo """
            ╔══════════════════════════════════════════════════╗
            ║   ❌  PIPELINE FAILED                            ║
            ║                                                  ║
            ║   Check the stage logs above for the error.    ║
            ║   Common causes:                                ║
            ║   • Docker daemon not reachable from agent     ║
            ║   • Invalid dockerhub-credentials in Jenkins   ║
            ║   • Backend /api/health returned non-200       ║
            ╚══════════════════════════════════════════════════╝
            """
            sh 'docker rm -f semp-smoke-test 2>/dev/null || true'
        }

        always {
            echo '>>> Cleaning up local Docker images...'
            sh """
                docker rmi ${BACKEND_IMAGE}:${IMAGE_TAG}  2>/dev/null || true
                docker rmi ${FRONTEND_IMAGE}:${IMAGE_TAG} 2>/dev/null || true
            """
        }

    } // end post

} // end pipeline
