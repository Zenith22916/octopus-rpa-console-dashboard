# core 包：把本目录加入 sys.path，保证模块间顶层裸名 import（import dashboard 等）
# 在「直接执行 python core/local_server.py」与「from core import local_server」两种方式下都可用。
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
